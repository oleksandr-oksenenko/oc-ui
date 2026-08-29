import fs from "node:fs";
import path from "node:path";
// TypeScript 7 exposes its compiler through the native toolchain and no longer
// exports the classic in-process compiler API. The compatibility package keeps
// this small structural check on that API without parsing source text itself.
import ts from "@typescript/typescript6";

const root = process.cwd();
const rendererRoot = path.join(root, "apps/desktop/src/renderer");
const componentsRoot = path.join(rendererRoot, "components");
const connectedAppFile = path.join(componentsRoot, "App", "ConnectedApp.tsx");
const connectedAppRoot = path.join(componentsRoot, "App", "ConnectedApp");

const isStoryFile = (filePath) =>
  /(?:^|[\\/])(?:story|stories)(?:[\\/]|$)/.test(filePath) ||
  /\.(?:story|stories)\.[^.]+$/.test(filePath);
const isTestFile = (filePath) => /\.(?:test|spec)\.[^.]+$/.test(filePath);
const appFile = path.join(rendererRoot, "App.tsx");
const isProductionComponent = (filePath) =>
  filePath === appFile ||
  (filePath.startsWith(`${componentsRoot}${path.sep}`) &&
    filePath.endsWith(".tsx") &&
    !isStoryFile(filePath) &&
    !isTestFile(filePath));

const walk = (directory) => {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(entryPath));
    else files.push(entryPath);
  }
  return files;
};

const allRendererFiles = walk(rendererRoot);
const storyFiles = allRendererFiles.filter(
  (filePath) => filePath.startsWith(`${componentsRoot}${path.sep}`) && isStoryFile(filePath),
);
const componentFiles = allRendererFiles.filter(isProductionComponent);
const compilerOptions = {
  allowJs: false,
  allowImportingTsExtensions: true,
  jsx: ts.JsxEmit.Preserve,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  noEmit: true,
  strict: true,
};
const host = ts.createCompilerHost(compilerOptions, true);
const program = ts.createProgram(componentFiles, compilerOptions, host);

const diagnostics = [];
const addDiagnostic = (filePath, message) => {
  diagnostics.push(`${path.relative(root, filePath)}: ${message}`);
};

const hasModifier = (node, kind) =>
  node.modifiers?.some((modifier) => modifier.kind === kind) === true;
const isComponentDeclaration = (declaration) =>
  ts.isFunctionDeclaration(declaration) ||
  ts.isClassDeclaration(declaration) ||
  (ts.isVariableDeclaration(declaration) &&
    declaration.initializer &&
    (ts.isArrowFunction(declaration.initializer) ||
      ts.isFunctionExpression(declaration.initializer)));

const collectLocalDeclarations = (sourceFile, names, localDeclarations) => {
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
      if (statement.name) localDeclarations.set(statement.name.text, statement);
      if (hasModifier(statement, ts.SyntaxKind.ExportKeyword) && statement.name) {
        names.add(statement.name.text);
      }
      continue;
    }

    if (!ts.isVariableStatement(statement)) continue;
    const exported = hasModifier(statement, ts.SyntaxKind.ExportKeyword);
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue;
      localDeclarations.set(declaration.name.text, declaration);
      if (exported && isComponentDeclaration(declaration)) names.add(declaration.name.text);
    }
  }
};

const collectNamedExports = (sourceFile, names, localDeclarations) => {
  for (const statement of sourceFile.statements) {
    if (!ts.isExportDeclaration(statement) || !statement.exportClause) continue;
    if (!ts.isNamedExports(statement.exportClause)) continue;
    for (const element of statement.exportClause.elements) {
      const localName = element.propertyName?.text ?? element.name.text;
      const declaration = localDeclarations.get(localName);
      if (declaration && isComponentDeclaration(declaration)) {
        names.add(element.name.text);
      }
    }
  }
};

const collectDefaultExport = (sourceFile, names, localDeclarations) => {
  for (const statement of sourceFile.statements) {
    if (!ts.isExportAssignment(statement) || statement.isExportEquals) continue;
    if (!ts.isIdentifier(statement.expression)) continue;
    const declaration = localDeclarations.get(statement.expression.text);
    if (declaration && isComponentDeclaration(declaration)) names.add(statement.expression.text);
  }
};

const exportedComponentNames = (sourceFile) => {
  const names = new Set();
  const localDeclarations = new Map();
  collectLocalDeclarations(sourceFile, names, localDeclarations);
  collectNamedExports(sourceFile, names, localDeclarations);
  collectDefaultExport(sourceFile, names, localDeclarations);

  return [...names].filter((name) => /^[A-Z][A-Za-z0-9]*$/.test(name));
};

const declaredComponentNames = (sourceFile) => {
  const names = [];
  const visit = (statement) => {
    if (
      (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
      statement.name &&
      /^[A-Z][A-Za-z0-9]*$/.test(statement.name.text)
    ) {
      names.push(statement.name.text);
    }
    if (ts.isVariableDeclaration(statement)) {
      const declaration = statement;
      if (
        ts.isIdentifier(declaration.name) &&
        /^[A-Z][A-Za-z0-9]*$/.test(declaration.name.text) &&
        isComponentDeclaration(declaration)
      ) {
        names.push(declaration.name.text);
      }
    }
    ts.forEachChild(statement, visit);
  };
  visit(sourceFile);
  return names;
};

const resolveImport = (specifier, containingFile) => {
  const resolved = ts.resolveModuleName(specifier, containingFile, compilerOptions, host)
    .resolvedModule?.resolvedFileName;
  return resolved ? path.normalize(resolved) : undefined;
};

const connectedAppFeature = (filePath) => {
  const relative = path.relative(connectedAppRoot, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
  const parts = relative.split(path.sep);
  return parts.length > 1 ? parts[0] : undefined;
};

const isConnectedAppEntry = (filePath) => {
  const feature = connectedAppFeature(filePath);
  return (
    feature !== undefined &&
    path.dirname(filePath) === path.join(connectedAppRoot, feature) &&
    path.basename(filePath).endsWith("Region.tsx")
  );
};

const childComponentRoot = (filePath) =>
  filePath === appFile
    ? path.join(componentsRoot, "App") + path.sep
    : path.join(path.dirname(filePath), path.basename(filePath, ".tsx")) + path.sep;

const componentImportViolation = (importer, imported) => {
  const importerFeature = connectedAppFeature(importer);
  const importedFeature = connectedAppFeature(imported);

  if (importer === connectedAppFile) {
    return importedFeature && isConnectedAppEntry(imported)
      ? undefined
      : `connected app must compose a feature entry, not ${path.relative(root, imported)}`;
  }

  if (importerFeature) {
    if (importedFeature !== importerFeature) {
      return `feature ${importerFeature} cannot import runtime component ${path.relative(
        root,
        imported,
      )} from ${importedFeature ? `feature ${importedFeature}` : "outside its feature"}`;
    }
    if (isConnectedAppEntry(importer) || imported.startsWith(childComponentRoot(importer))) {
      return undefined;
    }
    return `child component ${path.relative(root, imported)} must live below ${path.relative(
      root,
      childComponentRoot(importer).slice(0, -1),
    )}`;
  }

  if (importedFeature) {
    return isConnectedAppEntry(imported)
      ? undefined
      : `component outside ConnectedApp cannot import internal feature component ${path.relative(
          root,
          imported,
        )}`;
  }

  return imported.startsWith(childComponentRoot(importer))
    ? undefined
    : `child component ${path.relative(root, imported)} must live below ${path.relative(
        root,
        childComponentRoot(importer).slice(0, -1),
      )}`;
};

for (const filePath of storyFiles) {
  addDiagnostic(filePath, "story files are not allowed under renderer/components");
}

for (const filePath of componentFiles) {
  const sourceFile = program.getSourceFile(filePath);
  if (!sourceFile) {
    addDiagnostic(filePath, "could not parse the component source");
    continue;
  }

  const expectedName = path.basename(filePath, ".tsx");
  const exportedNames = exportedComponentNames(sourceFile);
  const declaredNames = declaredComponentNames(sourceFile);
  if (exportedNames.length !== 1 || exportedNames[0] !== expectedName) {
    addDiagnostic(
      filePath,
      `expected exactly one exported PascalCase component named ${expectedName}; found ${
        exportedNames.join(", ") || "none"
      }`,
    );
  }
  if (declaredNames.length !== 1 || declaredNames[0] !== expectedName) {
    addDiagnostic(
      filePath,
      `expected exactly one PascalCase component declaration named ${expectedName}; found ${
        declaredNames.join(", ") || "none"
      }`,
    );
  }

  if (path.dirname(filePath) === connectedAppRoot) {
    addDiagnostic(filePath, "connected app components must live in a feature directory");
  }

  if (filePath !== appFile && connectedAppFeature(filePath) === undefined) {
    const directory = path.dirname(filePath);
    const expectedParent =
      directory === path.join(componentsRoot, "App")
        ? appFile
        : path.join(path.dirname(directory), `${path.basename(directory)}.tsx`);
    if (!componentFiles.includes(expectedParent)) {
      addDiagnostic(
        filePath,
        `component directory must be owned by ${path.relative(root, expectedParent)}`,
      );
    }
  }

  if (!filePath.startsWith(`${componentsRoot}${path.sep}`) && filePath !== appFile) continue;
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue;
    if (statement.importClause?.isTypeOnly) continue;
    if (
      statement.importClause?.namedBindings &&
      ts.isNamedImports(statement.importClause.namedBindings) &&
      statement.importClause.namedBindings.elements.every((element) => element.isTypeOnly)
    ) {
      continue;
    }
    const specifier = statement.moduleSpecifier.text;
    if (!specifier.startsWith(".")) continue;
    const importedFile = resolveImport(specifier, filePath);
    if (!importedFile || !isProductionComponent(importedFile) || !importedFile.endsWith(".tsx"))
      continue;

    const violation = componentImportViolation(filePath, importedFile);
    if (violation) addDiagnostic(filePath, violation);
  }
}

if (diagnostics.length > 0) {
  console.error(diagnostics.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Component layout check passed (${componentFiles.length} production components).`);
}
