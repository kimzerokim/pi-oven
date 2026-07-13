import ts from "typescript";

import { TaskDispatchSchema, type TaskDispatch } from "../../.omp/extensions/pi-oven-runtime/runtime-contract";

export type TaskExampleParseResult =
  | { ok: true; value: TaskDispatch }
  | { ok: false; message: string };

function propertyName(node: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) {
    return node.text;
  }
  return undefined;
}

function literalValue(node: ts.Expression): unknown {
  if (ts.isParenthesizedExpression(node)) return literalValue(node.expression);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (ts.isArrayLiteralExpression(node)) return node.elements.map((element) => {
    if (ts.isSpreadElement(element)) throw new Error("spread elements are not supported");
    return literalValue(element as ts.Expression);
  });
  if (ts.isObjectLiteralExpression(node)) {
    const value: Record<string, unknown> = {};
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property)) {
        throw new Error("only literal property assignments are supported");
      }
      const name = propertyName(property.name);
      if (name === undefined) throw new Error("computed property names are not supported");
      if (Object.hasOwn(value, name)) throw new Error(`duplicate property ${name}`);
      value[name] = literalValue(property.initializer);
    }
    return value;
  }
  throw new Error(`non-literal expression ${ts.SyntaxKind[node.kind]} is not supported`);
}

function pathText(path: PropertyKey[]): string {
  return path.length === 0 ? "payload" : path.map(String).join(".");
}

export function parseTaskExample(source: string): TaskExampleParseResult {
  const file = ts.createSourceFile(
    "task-example.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const syntaxError = (
    file as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }
  ).parseDiagnostics[0];
  if (syntaxError) {
    return { ok: false, message: `invalid TypeScript: ${ts.flattenDiagnosticMessageText(syntaxError.messageText, " ")}` };
  }

  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "task") {
      calls.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);

  if (calls.length !== 1) {
    return { ok: false, message: `expected exactly one task(...) call; found ${calls.length}` };
  }
  if (calls[0].arguments.length !== 1) {
    return { ok: false, message: `task(...) must receive exactly one payload; found ${calls[0].arguments.length}` };
  }

  let input: unknown;
  try {
    input = literalValue(calls[0].arguments[0]);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }

  const parsed = TaskDispatchSchema.safeParse(input);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => {
        const keys = "keys" in issue && Array.isArray(issue.keys) ? issue.keys : [];
        const issuePath = [...issue.path, ...keys];
        return `${pathText(issuePath)}: ${issue.message}`;
      })
      .join("; ");
    return { ok: false, message: details };
  }
  return { ok: true, value: parsed.data };
}
