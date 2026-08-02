import { Project, Node, SourceFile, ObjectLiteralExpression, PropertyAssignment, ArrayLiteralExpression, CallExpression, SyntaxKind } from "ts-morph";
import * as path from "path";
import * as fs from "fs";

interface ExtractedField {
  name: string;
  type: string;
  required: boolean;
  unique: boolean;
  default?: string;
  enum?: string[];
  ref?: string;
  refPath?: string;
  index?: string | boolean;
  isNested?: boolean;
  nestedFields?: ExtractedField[];
}

interface ExtractedSchema {
  name: string; // Model name or sub-schema name
  collectionName?: string;
  moduleName: string;
  filePath: string;
  fields: ExtractedField[];
  plugins: string[];
  indexes: { fields: string; unique?: boolean }[];
  virtuals: { name: string; ref?: string; localField?: string; foreignField?: string; justOne?: boolean }[];
  timestamps: boolean;
}

interface Relationship {
  source: string;
  target: string;
  type: "one-to-one" | "one-to-many";
  label: string;
}

// Clean up types for display
function cleanType(typeText: string): string {
  const text = typeText.trim();
  if (text.includes("ObjectId") || text.includes("Schema.Types.ObjectId") || text.includes("Types.ObjectId")) {
    return "objectId";
  }
  if (text === "String" || text.toLowerCase() === "string") return "string";
  if (text === "Number" || text.toLowerCase() === "number") return "number";
  if (text === "Boolean" || text.toLowerCase() === "boolean") return "boolean";
  if (text === "Date" || text.toLowerCase() === "date") return "date";
  if (text === "Mixed" || text.includes("Schema.Types.Mixed") || text.includes("Types.Mixed")) return "mixed";
  
  // Array types
  if (text.startsWith("[") && text.endsWith("]")) {
    const inner = text.slice(1, -1).trim();
    return `${cleanType(inner)}[]`;
  }
  
  return text;
}

// Resolve enum values by parsing enums/objects recursively in the project files
function resolveEnumValues(sourceFile: SourceFile, name: string): string[] | undefined {
  // 1. Look for enum in current file
  const enumDec = sourceFile.getEnum(name);
  if (enumDec) {
    return enumDec.getMembers().map(m => {
      const val = m.getValue();
      return typeof val === "string" ? val : m.getName();
    });
  }
  
  // 2. Look for const variable in current file
  const varDec = sourceFile.getVariableDeclaration(name);
  if (varDec) {
    const init = varDec.getInitializer();
    if (init && Node.isObjectLiteralExpression(init)) {
      const values: string[] = [];
      for (const p of init.getProperties()) {
        if (Node.isPropertyAssignment(p)) {
          const valNode = p.getInitializer();
          if (valNode && Node.isStringLiteral(valNode)) {
            values.push(valNode.getLiteralValue());
          } else if (valNode) {
            values.push(valNode.getText());
          }
        }
      }
      return values;
    }
  }

  // 3. Look in import declarations
  for (const imp of sourceFile.getImportDeclarations()) {
    const namedImports = imp.getNamedImports().map(ni => ni.getName());
    if (namedImports.includes(name)) {
      const moduleSpecifier = imp.getModuleSpecifierValue();
      const project = sourceFile.getProject();
      const currentDir = sourceFile.getDirectoryPath();
      
      const absolutePath = path.resolve(currentDir, moduleSpecifier);
      const possiblePaths = [
        absolutePath + ".ts",
        absolutePath + "/index.ts",
        path.join(path.dirname(absolutePath), path.basename(absolutePath) + ".ts"),
        absolutePath
      ];
      
      for (const p of possiblePaths) {
        const resolvedFile = project.getSourceFile(p);
        if (resolvedFile) {
          const vals = resolveEnumValues(resolvedFile, name);
          if (vals) return vals;
        }
      }
    }
  }
  return undefined;
}

// Helper to extract enum values from field options
function extractEnum(sourceFile: SourceFile, node: Node): string[] | undefined {
  if (Node.isArrayLiteralExpression(node)) {
    return node.getElements().map(el => {
      if (Node.isStringLiteral(el)) return el.getLiteralValue();
      return el.getText();
    });
  }
  if (Node.isCallExpression(node)) {
    // e.g., Object.values(USER_ROLES)
    const exprText = node.getText();
    if (exprText.startsWith("Object.values(")) {
      const match = exprText.match(/Object\.values\(([^)]+)\)/);
      if (match) {
        const enumName = match[1].trim();
        return resolveEnumValues(sourceFile, enumName);
      }
    }
  }
  if (Node.isIdentifier(node)) {
    return resolveEnumValues(sourceFile, node.getText());
  }
  return undefined;
}

const MONGOOSE_FIELD_OPTIONS = new Set([
  "type", "required", "unique", "default", "enum", "index", "sparse", "ref",
  "select", "validate", "set", "get", "trim", "lowercase", "uppercase", "match",
  "min", "max", "minlength", "maxlength", "alias", "timestamps", "auto", "expires"
]);

function isMongooseFieldDefinition(objLiteral: ObjectLiteralExpression): boolean {
  const typeProp = objLiteral.getProperty("type");
  if (!typeProp) return false;
  
  // Check if there are other keys that are not standard mongoose options
  for (const prop of objLiteral.getProperties()) {
    if (Node.isPropertyAssignment(prop)) {
      const name = prop.getName();
      if (!MONGOOSE_FIELD_OPTIONS.has(name)) {
        return false;
      }
    }
  }
  return true;
}

function parseFieldInitializer(
  fieldName: string,
  initializer: Node,
  sourceFile: SourceFile
): ExtractedField | null {
  // Case 1: Simple type e.g., String, Schema.Types.ObjectId
  if (Node.isIdentifier(initializer) || Node.isPropertyAccessExpression(initializer)) {
    return {
      name: fieldName,
      type: cleanType(initializer.getText()),
      required: false,
      unique: false
    };
  }

  // Case 2: Array e.g., [String] or [{ type: Schema.Types.ObjectId, ref: 'User' }]
  if (Node.isArrayLiteralExpression(initializer)) {
    const elements = initializer.getElements();
    if (elements.length > 0) {
      const el = elements[0];
      if (Node.isObjectLiteralExpression(el)) {
        // Is it a field definition inside array? E.g., [{ type: String, required: true }]
        if (isMongooseFieldDefinition(el)) {
          const parsed = parseFieldInitializer(fieldName, el, sourceFile);
          if (parsed) {
            parsed.type = `${parsed.type}[]`;
            return parsed;
          }
        } else {
          // Array of embedded documents
          const nestedFields = parseSchemaObject(el, sourceFile);
          return {
            name: fieldName,
            type: "object[]",
            required: false,
            unique: false,
            isNested: true,
            nestedFields
          };
        }
      } else {
        // Array of simple type
        return {
          name: fieldName,
          type: `${cleanType(el.getText())}[]`,
          required: false,
          unique: false
        };
      }
    }
    return {
      name: fieldName,
      type: "array",
      required: false,
      unique: false
    };
  }

  // Case 3: Object Literal e.g., { type: String, required: true } or nested objects
  if (Node.isObjectLiteralExpression(initializer)) {
    if (isMongooseFieldDefinition(initializer)) {
      const typeProp = initializer.getProperty("type");
      if (typeProp && Node.isPropertyAssignment(typeProp)) {
        const typeInit = typeProp.getInitializer();
        if (typeInit) {
          if (Node.isObjectLiteralExpression(typeInit)) {
            // It is a nested object wrapped in 'type', e.g. fieldName: { type: { prop1: Type, prop2: Type }, select: 0 }
            const nestedFields = parseSchemaObject(typeInit, sourceFile);
            return {
              name: fieldName,
              type: "object",
              required: false,
              unique: false,
              isNested: true,
              nestedFields
            };
          } else if (Node.isArrayLiteralExpression(typeInit)) {
            // It is an array wrapped in 'type', e.g. fieldName: { type: [Number], required: true }
            const parsedArray = parseFieldInitializer(fieldName, typeInit, sourceFile);
            if (parsedArray) {
              // Copy other constraints from outer object literal to the parsed array field
              for (const p of initializer.getProperties()) {
                if (!Node.isPropertyAssignment(p)) continue;
                const name = p.getName();
                const initVal = p.getInitializer();
                if (!initVal) continue;

                if (name === "required") {
                  if (Node.isArrayLiteralExpression(initVal)) {
                    const first = initVal.getElements()[0];
                    parsedArray.required = first?.getText() === "true";
                  } else {
                    parsedArray.required = initVal.getText() === "true";
                  }
                } else if (name === "unique") {
                  parsedArray.unique = initVal.getText() === "true";
                } else if (name === "ref") {
                  parsedArray.ref = initVal.getText().replace(/['"]/g, "");
                } else if (name === "refPath") {
                  parsedArray.refPath = initVal.getText().replace(/['"]/g, "");
                } else if (name === "default") {
                  parsedArray.default = initVal.getText();
                } else if (name === "enum") {
                  parsedArray.enum = extractEnum(sourceFile, initVal);
                } else if (name === "index") {
                  parsedArray.index = initVal.getText();
                }
              }
              return parsedArray;
            }
          }
        }

        const typeText = typeInit?.getText() || "mixed";
        const field: ExtractedField = {
          name: fieldName,
          type: cleanType(typeText),
          required: false,
          unique: false
        };

        // Extract constraints
        for (const p of initializer.getProperties()) {
          if (!Node.isPropertyAssignment(p)) continue;
          const name = p.getName();
          const initVal = p.getInitializer();
          if (!initVal) continue;

          if (name === "required") {
            if (Node.isArrayLiteralExpression(initVal)) {
              const first = initVal.getElements()[0];
              field.required = first?.getText() === "true";
            } else {
              field.required = initVal.getText() === "true";
            }
          } else if (name === "unique") {
            field.unique = initVal.getText() === "true";
          } else if (name === "ref") {
            field.ref = initVal.getText().replace(/['"]/g, "");
          } else if (name === "refPath") {
            field.refPath = initVal.getText().replace(/['"]/g, "");
          } else if (name === "default") {
            field.default = initVal.getText();
          } else if (name === "enum") {
            field.enum = extractEnum(sourceFile, initVal);
          } else if (name === "index") {
            field.index = initVal.getText();
          }
        }
        return field;
      }
    }

    // Otherwise, treat as a nested object (embedded document)
    const nestedFields = parseSchemaObject(initializer, sourceFile);
    return {
      name: fieldName,
      type: "object",
      required: false,
      unique: false,
      isNested: true,
      nestedFields
    };
  }

  return null;
}

function parseSchemaObject(objLiteral: ObjectLiteralExpression, sourceFile: SourceFile): ExtractedField[] {
  const fields: ExtractedField[] = [];
  for (const property of objLiteral.getProperties()) {
    if (Node.isPropertyAssignment(property)) {
      const fieldName = property.getName();
      const initializer = property.getInitializer();
      if (!initializer) continue;
      
      const parsed = parseFieldInitializer(fieldName, initializer, sourceFile);
      if (parsed) {
        fields.push(parsed);
      }
    }
  }
  return fields;
}

function analyzeFile(sourceFile: SourceFile, moduleName: string): ExtractedSchema[] {
  const schemas: ExtractedSchema[] = [];
  const schemaVarToModelMap = new Map<string, string>();
  const modelToSchemaMap = new Map<string, ExtractedSchema>();

  // 1. Find all Schema variable definitions: const xSchema = new Schema(...)
  const newExpressions = sourceFile.getDescendants().filter(Node.isNewExpression);
  for (const newExpr of newExpressions) {
    const constructorText = newExpr.getExpression().getText();
    if (constructorText === "Schema" || constructorText === "mongoose.Schema" || constructorText.endsWith(".Schema")) {
      // Find the VariableDeclaration parent
      const varDec = newExpr.getFirstAncestor(Node.isVariableDeclaration);
      const schemaVarName = varDec ? varDec.getName() : "AnonymousSchema";

      const args = newExpr.getArguments();
      if (args.length === 0) continue;

      const firstArg = args[0];
      const secondArg = args[1];

      let fields: ExtractedField[] = [];
      if (Node.isObjectLiteralExpression(firstArg)) {
        fields = parseSchemaObject(firstArg, sourceFile);
      }

      let timestamps = false;
      if (secondArg && Node.isObjectLiteralExpression(secondArg)) {
        const tsProp = secondArg.getProperty("timestamps");
        if (tsProp && Node.isPropertyAssignment(tsProp)) {
          timestamps = tsProp.getInitializer()?.getText() === "true";
        }
      }

      const schema: ExtractedSchema = {
        name: schemaVarName, // temporary name
        moduleName,
        filePath: sourceFile.getFilePath(),
        fields,
        plugins: [],
        indexes: [],
        virtuals: [],
        timestamps
      };

      modelToSchemaMap.set(schemaVarName, schema);
    }
  }

  // 2. Find schema extensions: xSchema.plugin(...), xSchema.index(...), xSchema.virtual(...)
  const callExpressions = sourceFile.getDescendants().filter(Node.isCallExpression);
  for (const call of callExpressions) {
    const expr = call.getExpression();
    if (Node.isPropertyAccessExpression(expr)) {
      const leftName = expr.getExpression().getText();
      const rightName = expr.getName();
      const schema = modelToSchemaMap.get(leftName);

      if (schema) {
        const args = call.getArguments();
        if (rightName === "plugin" && args.length > 0) {
          schema.plugins.push(args[0].getText());
        } else if (rightName === "index" && args.length > 0) {
          const idxFields = args[0].getText();
          let unique = false;
          if (args.length > 1 && Node.isObjectLiteralExpression(args[1])) {
            const uniqProp = args[1].getProperty("unique");
            if (uniqProp && Node.isPropertyAssignment(uniqProp)) {
              unique = uniqProp.getInitializer()?.getText() === "true";
            }
          }
          schema.indexes.push({ fields: idxFields, unique });
        } else if (rightName === "virtual" && args.length > 0) {
          const virtualName = args[0].getText().replace(/['"]/g, "");
          const virtualInfo: { name: string; ref?: string; localField?: string; foreignField?: string; justOne?: boolean } = { name: virtualName };
          
          if (args.length > 1 && Node.isObjectLiteralExpression(args[1])) {
            const opts = args[1];
            const refProp = opts.getProperty("ref");
            const localProp = opts.getProperty("localField");
            const foreignProp = opts.getProperty("foreignField");
            const justOneProp = opts.getProperty("justOne");

            if (refProp && Node.isPropertyAssignment(refProp)) {
              virtualInfo.ref = refProp.getInitializer()?.getText().replace(/['"]/g, "");
            }
            if (localProp && Node.isPropertyAssignment(localProp)) {
              virtualInfo.localField = localProp.getInitializer()?.getText().replace(/['"]/g, "");
            }
            if (foreignProp && Node.isPropertyAssignment(foreignProp)) {
              virtualInfo.foreignField = foreignProp.getInitializer()?.getText().replace(/['"]/g, "");
            }
            if (justOneProp && Node.isPropertyAssignment(justOneProp)) {
              virtualInfo.justOne = justOneProp.getInitializer()?.getText() === "true";
            }
          }
          schema.virtuals.push(virtualInfo);
        }
      }
    }
  }

  // 3. Find model calls: model("ModelName", schemaVar) or mongoose.model("ModelName", schemaVar)
  for (const call of callExpressions) {
    const expr = call.getExpression();
    const isModelCall = expr.getText() === "model" || 
                        expr.getText() === "mongoose.model" || 
                        expr.getText().endsWith(".model");
    
    if (isModelCall) {
      const args = call.getArguments();
      if (args.length >= 2) {
        const modelName = args[0].getText().replace(/['"]/g, "");
        const schemaArg = args[1];

        if (Node.isIdentifier(schemaArg)) {
          const schemaVarName = schemaArg.getText();
          schemaVarToModelMap.set(schemaVarName, modelName);
        } else if (Node.isNewExpression(schemaArg)) {
          // Direct inline Schema definition
          const schemaObj = schemaArg.getArguments()[0];
          let fields: ExtractedField[] = [];
          if (schemaObj && Node.isObjectLiteralExpression(schemaObj)) {
            fields = parseSchemaObject(schemaObj, sourceFile);
          }

          let timestamps = false;
          const optsObj = schemaArg.getArguments()[1];
          if (optsObj && Node.isObjectLiteralExpression(optsObj)) {
            const tsProp = optsObj.getProperty("timestamps");
            if (tsProp && Node.isPropertyAssignment(tsProp)) {
              timestamps = tsProp.getInitializer()?.getText() === "true";
            }
          }

          const schema: ExtractedSchema = {
            name: modelName,
            moduleName,
            filePath: sourceFile.getFilePath(),
            fields,
            plugins: [],
            indexes: [],
            virtuals: [],
            timestamps
          };
          schemas.push(schema);
        }
      }
    }
  }

  // Map variable-based schemas to their model names
  for (const [schemaVar, modelName] of schemaVarToModelMap.entries()) {
    const schema = modelToSchemaMap.get(schemaVar);
    if (schema) {
      schema.name = modelName;
      schemas.push(schema);
    }
  }

  // Export variable-based schemas that do not map to a top-level model (sub-schemas/embedded schemas)
  for (const [schemaVar, schema] of modelToSchemaMap.entries()) {
    if (!schemaVarToModelMap.has(schemaVar)) {
      schema.name = schemaVar;
      schemas.push(schema);
    }
  }

  return schemas;
}

function escapeXml(unsafe: string): string {
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}

function capitalize(text: string): string {
  if (!text) return "";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function getModulePalette(moduleName: string): { fill: string, stroke: string } {
  const palettes = [
    { fill: "#1F203F", stroke: "#3B52DF" }, // Indigo
    { fill: "#162E3B", stroke: "#189AB4" }, // Teal
    { fill: "#281E3D", stroke: "#8A2BE2" }, // Purple
    { fill: "#142D26", stroke: "#10B981" }, // Emerald
    { fill: "#32221A", stroke: "#F59E0B" }, // Amber
    { fill: "#301A24", stroke: "#EC4899" }, // Rose
    { fill: "#2B223D", stroke: "#A78BFA" }, // Lavender
    { fill: "#1B2A32", stroke: "#06B6D4" }, // Cyan
  ];
  
  const name = moduleName || "default";
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % palettes.length;
  return palettes[index];
}

function estimateRowHeight(labelHtml: string, colWidth: number): number {
  const plainText = labelHtml.replace(/<[^>]+>/g, "");
  const usableWidth = colWidth - 20; // 10px spacing left/right
  // Font size is 11px. Average character width is about 6.2px.
  const charsPerLine = Math.floor(usableWidth / 6.2);
  const lines = Math.ceil(plainText.length / charsPerLine) || 1;
  return 28 + (lines - 1) * 15; // 28px default height, +15px for each extra wrapped line
}

interface FieldLabelInfo {
  id: string;
  labelHtml: string;
}

function getFieldLabels(schema: ExtractedSchema, entName: string): FieldLabelInfo[] {
  const list: FieldLabelInfo[] = [];

  // Pure high-contrast black background badges with white text
  const pkBadge = `<span style="background-color:#000000;color:#FFFFFF;padding:1px 3px;font-size:9px;font-weight:bold;border-radius:2px;margin-left:4px;">PK</span>`;
  const fkBadge = `<span style="background-color:#000000;color:#FFFFFF;padding:1px 3px;font-size:9px;font-weight:bold;border-radius:2px;margin-left:4px;">FK</span>`;
  const ukBadge = `<span style="background-color:#000000;color:#FFFFFF;padding:1px 3px;font-size:9px;font-weight:bold;border-radius:2px;margin-left:4px;">UK</span>`;
  const idxBadge = `<span style="background-color:#000000;color:#FFFFFF;padding:1px 3px;font-size:9px;font-weight:bold;border-radius:2px;margin-left:4px;">IDX</span>`;
  const enumBadge = `<span style="background-color:#000000;color:#FFFFFF;padding:1px 3px;font-size:9px;font-weight:bold;border-radius:2px;margin-left:4px;">ENUM</span>`;

  // 1. _id field
  list.push({
    id: `field_${entName}__id`,
    labelHtml: `<b>_id</b>: <b>objectId</b> ${pkBadge}`
  });

  // 2. Regular fields
  const addFields = (fields: ExtractedField[], prefix = "") => {
    for (const field of fields) {
      if (field.name === "_id") continue;
      if (field.isNested && field.type === "object[]") continue;
      if (field.isNested && field.type === "object" && field.nestedFields) {
        addFields(field.nestedFields, `${prefix}${field.name}_`);
        continue;
      }

      const cleanFieldName = `${prefix}${field.name}`.replace(/[^a-zA-Z0-9_]/g, "_");
      
      // Required fields: Bold name
      const nameHtml = field.required ? `<b>${cleanFieldName}</b>` : cleanFieldName;
      
      // Foreign Keys: Italic type
      const typeText = field.ref ? `<i>${cleanType(field.type)}</i>` : cleanType(field.type);
      
      let badges = "";
      if (field.unique) {
        badges += ukBadge;
      }
      if (field.ref || field.refPath) {
        badges += fkBadge;
      }
      if (field.index) {
        badges += idxBadge;
      }
      if (field.enum && field.enum.length > 0) {
        badges += enumBadge;
      }

      const comments: string[] = [];
      if (field.default !== undefined) {
        comments.push(`def: ${field.default.replace(/"/g, "'")}`);
      }
      if (field.enum && field.enum.length > 0) {
        const cleanEnums = field.enum.map(ev => ev.replace(/"/g, "'"));
        comments.push(`enum: ${cleanEnums.join("|")}`);
      }

      // Pure black high contrast color for italic comments
      const commentStr = comments.length > 0 ? ` <span style="color:#000000; font-size:10px; font-style:italic;">(${comments.join(", ")})</span>` : "";
      const labelHtml = `${nameHtml}: ${typeText}${badges}${commentStr}`;

      list.push({
        id: `field_${entName}_${cleanFieldName}`,
        labelHtml
      });
    }
  };
  addFields(schema.fields);

  // 3. Timestamps
  if (schema.timestamps) {
    list.push({
      id: `field_${entName}_createdAt`,
      labelHtml: `<b>createdAt</b>: date`
    });
    list.push({
      id: `field_${entName}_updatedAt`,
      labelHtml: `<b>updatedAt</b>: date`
    });
  }

  return list;
}

// ----------------------------------------------------
// GRAPH LAYOUT OPTIMIZATION (Crossing Reduction)
// ----------------------------------------------------

function ccw(A: {x: number, y: number}, B: {x: number, y: number}, C: {x: number, y: number}): boolean {
  return (C.y - A.y) * (B.x - A.x) > (B.y - A.y) * (C.x - A.x);
}

function intersect(
  A: {x: number, y: number},
  B: {x: number, y: number},
  C: {x: number, y: number},
  D: {x: number, y: number}
): boolean {
  return ccw(A, C, D) !== ccw(B, C, D) && ccw(A, B, C) !== ccw(A, B, D);
}

function countCrossings(
  positions: Map<string, {x: number, y: number}>,
  edges: {source: string, target: string}[]
): number {
  let crossings = 0;
  const edgeList = edges.map(e => {
    const p1 = positions.get(e.source);
    const p2 = positions.get(e.target);
    return { p1, p2, source: e.source, target: e.target };
  }).filter(e => e.p1 !== undefined && e.p2 !== undefined) as { p1: {x: number, y: number}, p2: {x: number, y: number}, source: string, target: string }[];

  for (let i = 0; i < edgeList.length; i++) {
    const e1 = edgeList[i];
    for (let j = i + 1; j < edgeList.length; j++) {
      const e2 = edgeList[j];
      // Skip if sharing an endpoint
      if (e1.source === e2.source || e1.source === e2.target || e1.target === e2.source || e1.target === e2.target) {
        continue;
      }
      if (intersect(e1.p1, e1.p2, e2.p1, e2.p2)) {
        crossings++;
      }
    }
  }
  return crossings;
}

function getLayoutPositions(
  columns: string[][],
  tableHeights: Map<string, number>,
  colWidth: number,
  horizontalSpacing: number,
  verticalSpacing: number,
  paddingX: number,
  paddingTop: number
): Map<string, {x: number, y: number}> {
  const positions = new Map<string, {x: number, y: number}>();
  const columnContainerWidth = colWidth + 2 * paddingX;

  for (let colIdx = 0; colIdx < columns.length; colIdx++) {
    const tables = columns[colIdx];
    const colX = colIdx * (columnContainerWidth + horizontalSpacing);
    let currentY = paddingTop;

    for (const tableName of tables) {
      const tHeight = tableHeights.get(tableName) || 100;
      const centerX = colX + paddingX + colWidth / 2;
      const centerY = currentY + tHeight / 2;
      positions.set(tableName, { x: centerX, y: centerY });
      currentY += tHeight + verticalSpacing;
    }
  }
  return positions;
}

function optimizeLayout(
  columns: string[][],
  tableHeights: Map<string, number>,
  edges: {source: string, target: string}[],
  colWidth: number,
  horizontalSpacing: number,
  verticalSpacing: number,
  paddingX: number,
  paddingTop: number
): string[][] {
  const bestColumns = columns.map(col => [...col]);
  let bestPositions = getLayoutPositions(bestColumns, tableHeights, colWidth, horizontalSpacing, verticalSpacing, paddingX, paddingTop);
  
  const getEdgeLength = (positions: Map<string, {x: number, y: number}>) => {
    let length = 0;
    for (const edge of edges) {
      const p1 = positions.get(edge.source);
      const p2 = positions.get(edge.target);
      if (p1 && p2) {
        length += Math.abs(p1.x - p2.x) + Math.abs(p1.y - p2.y);
      }
    }
    return length;
  };

  const getCost = (positions: Map<string, {x: number, y: number}>) => {
    const crossings = countCrossings(positions, edges);
    const edgeLength = getEdgeLength(positions);
    return crossings * 100000 + edgeLength;
  };

  let bestCost = getCost(bestPositions);
  let improved = true;
  let iterations = 0;
  const maxIterations = 2000;

  while (improved && iterations < maxIterations) {
    improved = false;
    iterations++;

    const colIdx = Math.floor(Math.random() * bestColumns.length);
    const col = bestColumns[colIdx];
    if (col.length < 2) continue;

    const idx1 = Math.floor(Math.random() * col.length);
    let idx2 = Math.floor(Math.random() * col.length);
    while (idx2 === idx1) {
      idx2 = Math.floor(Math.random() * col.length);
    }

    const temp = col[idx1];
    col[idx1] = col[idx2];
    col[idx2] = temp;

    const tempPositions = getLayoutPositions(bestColumns, tableHeights, colWidth, horizontalSpacing, verticalSpacing, paddingX, paddingTop);
    const tempCost = getCost(tempPositions);

    if (tempCost < bestCost) {
      bestCost = tempCost;
      bestPositions = tempPositions;
      improved = true;
    } else {
      const temp2 = col[idx1];
      col[idx1] = col[idx2];
      col[idx2] = temp2;
    }
  }

  return bestColumns;
}

// ----------------------------------------------------
// BUSINESS DOMAIN CONFIGURATION
// ----------------------------------------------------

function getDomainGroupIndex(moduleName: string): number {
  const normalized = moduleName.toLowerCase();
  
  // 0. Identity & Access
  if (["auth", "user", "role", "permission", "rbac", "resettoken", "fcmtoken"].includes(normalized)) {
    return 0;
  }
  // 1. Ride & Booking
  if (["ride", "ridecategory", "tracking", "livetrips", "cancellationpolicy", "cancellationreason", "cancellationanalytics", "fareconfiguration", "peakhour", "surgerule"].includes(normalized)) {
    return 1;
  }
  // 2. Driver & Fleet
  if (["driver", "drivermanagement", "driverdutypolicy", "car", "tier", "servicearea", "servicecategory"].includes(normalized)) {
    return 2;
  }
  // 3. Finance & Payment
  if (["wallet", "transaction", "payout", "pendingpayment", "stripe"].includes(normalized)) {
    return 3;
  }
  // 4. Communication & Engagement
  if (["chat", "message", "notification", "notificationpreference", "broadcast", "banner", "referral", "review"].includes(normalized)) {
    return 4;
  }
  // 5. Support & Operations
  if (["support", "emergencycontact", "emergencyhelpline", "lostandfound", "lostandfounditemcategory", "reportissuecategory", "tripreport", "aisupport", "aiknowledge", "faq"].includes(normalized)) {
    return 5;
  }
  // 6. System & Configuration
  return 6;
}

const DOMAIN_NAMES = [
  "Identity & Access Domain",
  "Ride & Booking Domain",
  "Driver & Fleet Domain",
  "Finance & Payment Domain",
  "Communication & Engagement Domain",
  "Support & Operations Domain",
  "System & Configuration Domain"
];

function findFieldByPath(fields: ExtractedField[], pathText: string): ExtractedField | undefined {
  const parts = pathText.split(".");
  let currentFields = fields;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const found = currentFields.find(f => f.name === part);
    if (!found) return undefined;
    if (i === parts.length - 1) return found;
    if (found.nestedFields) {
      currentFields = found.nestedFields;
    } else {
      return undefined;
    }
  }
  return undefined;
}

function partitionSchemas(
  nativeSchemas: ExtractedSchema[],
  relations: Relationship[]
): ExtractedSchema[][] {
  const maxEntities = 15;
  if (nativeSchemas.length <= maxEntities) {
    return [nativeSchemas];
  }

  const adj = new Map<string, Set<string>>();
  for (const s of nativeSchemas) {
    adj.set(s.name, new Set());
  }

  for (const r of relations) {
    if (adj.has(r.source) && adj.has(r.target)) {
      adj.get(r.source)!.add(r.target);
      adj.get(r.target)!.add(r.source);
    }
  }

  const visited = new Set<string>();
  const components: string[][] = [];

  for (const s of nativeSchemas) {
    if (!visited.has(s.name)) {
      const comp: string[] = [];
      const queue = [s.name];
      visited.add(s.name);

      while (queue.length > 0) {
        const curr = queue.shift()!;
        comp.push(curr);
        for (const neighbor of adj.get(curr) || []) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        }
      }
      components.push(comp);
    }
  }

  const finalGroups: ExtractedSchema[][] = [];
  for (const comp of components) {
    if (comp.length <= maxEntities) {
      const schemas = comp.map(name => nativeSchemas.find(s => s.name === name)!);
      finalGroups.push(schemas);
    } else {
      let currentChunk: string[] = [];
      for (const name of comp) {
        currentChunk.push(name);
        if (currentChunk.length === maxEntities) {
          finalGroups.push(currentChunk.map(n => nativeSchemas.find(s => s.name === n)!));
          currentChunk = [];
        }
      }
      if (currentChunk.length > 0) {
        finalGroups.push(currentChunk.map(n => nativeSchemas.find(s => s.name === n)!));
      }
    }
  }

  return finalGroups;
}


function buildDrawioDiagram(
  moduleName: string,
  nativeSchemas: ExtractedSchema[],
  allSchemasMap: Map<string, ExtractedSchema>,
  moduleMap: Map<string, string[]>,
  codeRelations: Relationship[] = [],
  isOverview: boolean = false
): string {
  const schemasToRender = new Map<string, ExtractedSchema>();
  const relationships: Relationship[] = [];
  const nativeNames = new Set(nativeSchemas.map(s => s.name));

  const isWhole = moduleName === "whole-er-diagram";

  // Add all native schemas to render
  for (const schema of nativeSchemas) {
    if (isOverview) {
      // In overview diagrams, render all entities as lightweight (only PK)
      schemasToRender.set(schema.name, {
        ...schema,
        fields: [{ name: "_id", type: "objectId", required: true, unique: true }],
        timestamps: false,
        indexes: [],
        virtuals: []
      });
    } else {
      schemasToRender.set(schema.name, schema);
    }
  }

  // Find Depth=1 related schemas and relationships recursively
  const addTargetSchema = (targetName: string) => {
    if (!schemasToRender.has(targetName)) {
      const targetSchema = allSchemasMap.get(targetName);
      if (targetSchema) {
        // Shared entity from another module or overview: display only PK field
        schemasToRender.set(targetName, {
          ...targetSchema,
          fields: [{ name: "_id", type: "objectId", required: true, unique: true }],
          timestamps: false,
          indexes: [],
          virtuals: []
        });
      } else {
        // Create a stub schema for boundary node
        schemasToRender.set(targetName, {
          name: targetName,
          moduleName: "shared",
          filePath: "",
          fields: [{ name: "_id", type: "objectId", required: true, unique: true }],
          plugins: [],
          indexes: [],
          virtuals: [],
          timestamps: false
        });
      }
    }
  };

  // Add code-level relations (e.g. populate, $lookup)
  for (const rel of codeRelations) {
    const isRelevant = isWhole || isOverview || nativeNames.has(rel.source) || nativeNames.has(rel.target);
    if (isRelevant) {
      relationships.push(rel);
      if (isWhole || isOverview) {
        addTargetSchema(rel.source);
        addTargetSchema(rel.target);
      } else {
        if (nativeNames.has(rel.source)) addTargetSchema(rel.target);
        if (nativeNames.has(rel.target)) addTargetSchema(rel.source);
      }
    }
  }

  for (const nativeSchema of nativeSchemas) {
    const checkFields = (fields: ExtractedField[], parentEntity: string, prefix = "") => {
      for (const field of fields) {
        const fieldPath = prefix ? `${prefix}.${field.name}` : field.name;

        // 1. Direct references (ref)
        if (field.ref) {
          const targetName = field.ref;
          relationships.push({
            source: targetName,
            target: parentEntity,
            type: (field.unique && !field.type.endsWith("[]")) ? "one-to-one" : "one-to-many",
            label: fieldPath
          });
          addTargetSchema(targetName);
        }

        // 2. Dynamic references (refPath)
        if (field.refPath) {
          const pathField = findFieldByPath(nativeSchema.fields, field.refPath);
          if (pathField && pathField.enum && pathField.enum.length > 0) {
            for (const modelName of pathField.enum) {
              relationships.push({
                source: modelName,
                target: parentEntity,
                type: "one-to-many",
                label: `${fieldPath} (refPath: ${field.refPath})`
              });
              addTargetSchema(modelName);
            }
          }
        }

        // 3. Embedded sub-schemas matching defined schemas
        const cleanTypeVal = field.type.replace(/\[\]$/, "");
        if (allSchemasMap.has(cleanTypeVal) && cleanTypeVal !== parentEntity) {
          relationships.push({
            source: parentEntity,
            target: cleanTypeVal,
            type: field.type.endsWith("[]") ? "one-to-many" : "one-to-one",
            label: fieldPath
          });
          addTargetSchema(cleanTypeVal);
        }

        // Recurse into nested fields (e.g. nested objects or embedded schemas)
        if (field.isNested && field.nestedFields) {
          if (field.type === "object[]") {
            const subEntityName = `${parentEntity}_${capitalize(field.name)}`;
            
            if (isOverview) {
              schemasToRender.set(subEntityName, {
                name: subEntityName,
                moduleName: nativeSchema.moduleName,
                filePath: nativeSchema.filePath,
                fields: [{ name: "_id", type: "objectId", required: true, unique: true }],
                plugins: [],
                indexes: [],
                virtuals: [],
                timestamps: false
              });
            } else {
              schemasToRender.set(subEntityName, {
                name: subEntityName,
                moduleName: nativeSchema.moduleName,
                filePath: nativeSchema.filePath,
                fields: field.nestedFields,
                plugins: [],
                indexes: [],
                virtuals: [],
                timestamps: false
              });
            }

            relationships.push({
              source: parentEntity,
              target: subEntityName,
              type: "one-to-many",
              label: field.name
            });

            // Recurse inside the sub-entity fields
            checkFields(field.nestedFields, subEntityName, "");
          } else {
            // Recurse within the same parent entity
            checkFields(field.nestedFields, parentEntity, fieldPath);
          }
        }
      }
    };

    checkFields(nativeSchema.fields, nativeSchema.name);

    // Virtual populates
    for (const virt of nativeSchema.virtuals) {
      if (virt.ref && virt.localField && virt.foreignField) {
        const targetName = virt.ref;
        relationships.push({
          source: nativeSchema.name,
          target: targetName,
          type: virt.justOne ? "one-to-one" : "one-to-many",
          label: `${virt.name} (virtual)`
        });
        addTargetSchema(targetName);
      }
    }
  }

  const sortedEntityNames = Array.from(schemasToRender.keys()).sort((a, b) => a.localeCompare(b));

  const colWidth = 340;
  const schemaInfos = new Map<string, {
    labels: FieldLabelInfo[];
    heights: number[];
    totalHeight: number;
  }>();

  for (const entName of sortedEntityNames) {
    const schema = schemasToRender.get(entName)!;
    const labels = getFieldLabels(schema, entName);
    const heights = labels.map(l => estimateRowHeight(l.labelHtml, colWidth));
    const totalHeight = 38 + heights.reduce((sum, h) => sum + h, 0);
    schemaInfos.set(entName, { labels, heights, totalHeight });
  }

  // Calculate dynamic spacing rules based on sizing density
  const totalEntities = sortedEntityNames.length;
  const totalRels = relationships.length;
  let scale = 1.0;
  if (totalEntities > 30 || totalRels > 30) {
    scale = 1.25;
  }
  if (totalEntities > 60 || totalRels > 60) {
    scale = 1.5;
  }

  const horizontalSpacing = Math.round(300 * scale);
  const verticalSpacing = Math.round(200 * scale);

  const paddingX = 30;
  const paddingTop = 60;
  const paddingBottom = 30;
  const leftMargin = 100;
  const topMargin = 100;
  const bottomMargin = 100;

  const columnContainerWidth = colWidth + 2 * paddingX;

  // Initialize columns and filter active columns
  let columns: string[][] = [];
  let colTitles: string[] = [];

  if (isWhole) {
    // Dynamically identify all active modules present in the schemas being rendered
    const activeModules = Array.from(
      new Set(Array.from(schemasToRender.values()).map(s => s.moduleName))
    ).filter(m => m !== "shared").sort();
    
    if (Array.from(schemasToRender.values()).some(s => s.moduleName === "shared")) {
      activeModules.push("shared");
    }

    columns = Array.from({ length: activeModules.length }, () => []);
    colTitles = activeModules.map(modName => {
      if (modName === "shared") return "Shared / External Dependencies";
      return `${capitalize(modName)} Module`;
    });

    for (const entName of sortedEntityNames) {
      const schema = schemasToRender.get(entName)!;
      const colIdx = activeModules.indexOf(schema.moduleName);
      if (colIdx !== -1) {
        columns[colIdx].push(entName);
      }
    }
  } else {
    columns = Array.from({ length: 3 }, () => []);
    colTitles = [
      "Parent Lookups / External Dependencies",
      isOverview ? `${capitalize(moduleName)} Core & Overview` : `Core Module: ${capitalize(moduleName)}`,
      "Dependent Entities & Sub-Schemas"
    ];

    const leftTables: string[] = [];
    const centerTables: string[] = [];
    const rightTables: string[] = [];

    for (const entName of sortedEntityNames) {
      if (nativeNames.has(entName)) {
        centerTables.push(entName);
      } else {
        const isLookup = relationships.some(rel => rel.source === entName && nativeNames.has(rel.target));
        if (isLookup) {
          leftTables.push(entName);
        } else {
          rightTables.push(entName);
        }
      }
    }

    columns[0] = leftTables;
    columns[1] = centerTables;
    columns[2] = rightTables;

    // Filter empty columns
    const activeColumns: string[][] = [];
    const activeTitles: string[] = [];
    for (let i = 0; i < columns.length; i++) {
      if (columns[i].length > 0) {
        activeColumns.push(columns[i]);
        activeTitles.push(colTitles[i]);
      }
    }
    columns = activeColumns;
    colTitles = activeTitles;
  }

  // Optimize vertical layout of tables in each column to minimize crossing and length
  columns = optimizeLayout(
    columns,
    new Map(Array.from(schemaInfos.entries()).map(([k, v]) => [k, v.totalHeight])),
    relationships,
    colWidth,
    horizontalSpacing,
    verticalSpacing,
    paddingX,
    paddingTop
  );

  // Calculate layout coordinates
  const columnHeights = columns.map(col => {
    if (col.length === 0) return 0;
    let h = paddingTop;
    for (let i = 0; i < col.length; i++) {
      const entName = col[i];
      h += schemaInfos.get(entName)!.totalHeight;
      if (i < col.length - 1) {
        h += verticalSpacing;
      }
    }
    h += paddingBottom;
    return h;
  });

  const tableRelativePositions = new Map<string, { rx: number, ry: number }>();
  const tableParentIds = new Map<string, string>();

  // Determine dynamic canvas size and coordinates using grid if isWhole
  const numColumns = columns.length;
  const maxColsPerRow = 6;
  const colsPerRow = isWhole ? Math.min(maxColsPerRow, numColumns) : numColumns;
  const numRows = Math.ceil(numColumns / colsPerRow);

  const rowHeights: number[] = [];
  const rowYPositions: number[] = [];
  let currentY = topMargin;

  for (let r = 0; r < numRows; r++) {
    const rowColHeights = columnHeights.slice(r * colsPerRow, (r + 1) * colsPerRow);
    const rowH = Math.max(...rowColHeights, 100);
    rowHeights.push(rowH);
    rowYPositions.push(currentY);
    // Vertical spacing between grid rows
    currentY += rowH + verticalSpacing * 2;
  }

  const pageCols = Math.min(numColumns, colsPerRow);
  const pageWidth = Math.round(leftMargin + pageCols * (columnContainerWidth + horizontalSpacing) - horizontalSpacing + leftMargin);
  const pageHeight = Math.round(currentY - (verticalSpacing * 2) + bottomMargin);

  // XML construction
  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<mxfile host="Electron" modified="${new Date().toISOString()}" agent="Antigravity" version="24.0.0" type="device">\n`;
  xml += `  <diagram id="Page-1" name="Page-1">\n`;
  xml += `    <mxGraphModel dx="1422" dy="804" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${pageWidth}" pageHeight="${pageHeight}" math="0" shadow="0" background="#FFFFFF">\n`;
  xml += `      <root>\n`;
  xml += `        <mxCell id="0" />\n`;
  xml += `        <mxCell id="1" parent="0" />\n`;

  // Draw column containers (domains/categories)
  for (let colIdx = 0; colIdx < numColumns; colIdx++) {
    const title = colTitles[colIdx];
    const colHeight = columnHeights[colIdx] || 100;

    const r = Math.floor(colIdx / colsPerRow);
    const c = colIdx % colsPerRow;

    const startY = Math.round(rowYPositions[r] + (rowHeights[r] - colHeight) / 2);
    const colX = Math.round(leftMargin + c * (columnContainerWidth + horizontalSpacing));
    const cardId = `column_${colIdx}`;

    // Clean white column card with black dashed border representing domain structure
    const containerStyle = `rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#000000;strokeWidth=1.5;dashed=1;arcSize=6;align=left;verticalAlign=top;spacingLeft=15;spacingTop=12;fontColor=#000000;fontSize=14;fontStyle=1;container=1;collapsible=0;recursiveResize=0;`;
    
    xml += `        <mxCell id="${cardId}" value="${escapeXml(title)}" style="${containerStyle}" vertex="1" parent="1">\n`;
    xml += `          <mxGeometry x="${colX}" y="${startY}" width="${columnContainerWidth}" height="${colHeight}" as="geometry" />\n`;
    xml += `        </mxCell>\n`;

    const tables = columns[colIdx];
    let currentRelY = paddingTop;
    for (let i = 0; i < tables.length; i++) {
      const tName = tables[i];
      tableRelativePositions.set(tName, { rx: paddingX, ry: currentRelY });
      tableParentIds.set(tName, cardId);
      currentRelY += schemaInfos.get(tName)!.totalHeight + verticalSpacing;
    }
  }

  // Set of all defined cell IDs (for validation)
  const definedCellIds = new Set<string>();
  definedCellIds.add("0");
  definedCellIds.add("1");
  for (let colIdx = 0; colIdx < numColumns; colIdx++) {
    definedCellIds.add(`column_${colIdx}`);
  }

  for (const entName of sortedEntityNames) {
    const tableId = `table_${entName}`;
    definedCellIds.add(tableId);
    definedCellIds.add(`field_${entName}__id`);
    definedCellIds.add(`field_${entName}_createdAt`);
    definedCellIds.add(`field_${entName}_updatedAt`);

    const schema = schemasToRender.get(entName)!;
    const addFieldsToIds = (fields: ExtractedField[], prefix = "") => {
      for (const field of fields) {
        if (field.name === "_id") continue;
        if (field.isNested && field.type === "object[]") continue;
        if (field.isNested && field.type === "object" && field.nestedFields) {
          addFieldsToIds(field.nestedFields, `${prefix}${field.name}_`);
          continue;
        }
        const cleanFieldName = `${prefix}${field.name}`.replace(/[^a-zA-Z0-9_]/g, "_");
        definedCellIds.add(`field_${entName}_${cleanFieldName}`);
      }
    };
    addFieldsToIds(schema.fields);
  }

  // Draw tables and fields inside their column parents
  for (const entName of sortedEntityNames) {
    const schema = schemasToRender.get(entName)!;
    const rpos = tableRelativePositions.get(entName)!;
    const parentId = tableParentIds.get(entName)!;
    const info = schemaInfos.get(entName)!;
    const tableId = `table_${entName}`;

    const isNative = isWhole || nativeNames.has(entName);
    
    let tableStyle = "";
    if (isNative) {
      // Solid black header background, white text, black border 2px
      tableStyle = `swimlane;fontStyle=1;childLayout=stackLayout;horizontal=1;startSize=38;horizontalStack=0;resizeParent=1;resizeParentMax=0;resizeLast=0;collapsible=1;marginBottom=0;whiteSpace=wrap;html=1;fillColor=#000000;swimlaneFillColor=#FFFFFF;strokeColor=#000000;strokeWidth=2;fontColor=#FFFFFF;fontSize=13;align=center;`;
    } else {
      // Dashed border, white header background, black text, black border 2px for shared entities
      tableStyle = `swimlane;fontStyle=1;childLayout=stackLayout;horizontal=1;startSize=38;horizontalStack=0;resizeParent=1;resizeParentMax=0;resizeLast=0;collapsible=1;marginBottom=0;whiteSpace=wrap;html=1;fillColor=#FFFFFF;swimlaneFillColor=#FFFFFF;strokeColor=#000000;strokeWidth=2;dashed=1;fontColor=#000000;fontSize=13;align=center;`;
    }
    
    xml += `        <mxCell id="${tableId}" value="${escapeXml(entName)}" style="${tableStyle}" vertex="1" parent="${parentId}">\n`;
    xml += `          <mxGeometry x="${rpos.rx}" y="${rpos.ry}" width="${colWidth}" height="${info.totalHeight}" as="geometry" />\n`;
    xml += `        </mxCell>\n`;

    let currentY = 38;
    const rowStyle = `text;strokeColor=none;fillColor=none;align=left;verticalAlign=middle;spacingLeft=10;spacingRight=10;overflow=hidden;rotatable=0;points=[[0,0.5],[1,0.5]];portConstraint=eastwest;whiteSpace=wrap;html=1;fontSize=11;fontColor=#000000;`;

    for (let i = 0; i < info.labels.length; i++) {
      const fLabel = info.labels[i];
      const fHeight = info.heights[i];
      
      xml += `        <mxCell id="${fLabel.id}" value="${escapeXml(fLabel.labelHtml)}" style="${rowStyle}" vertex="1" parent="${tableId}">\n`;
      xml += `          <mxGeometry y="${currentY}" width="${colWidth}" height="${fHeight}" as="geometry" />\n`;
      xml += `        </mxCell>\n`;
      currentY += fHeight;
    }
  }

  // Draw relationship connectors
  const renderedRelationships = new Set<string>();
  let edgeIdCounter = 1;
  const pairConnectionCount = new Map<string, number>();

  for (const rel of relationships) {
    const hasNativeNode = nativeNames.has(rel.source) || nativeNames.has(rel.target);
    if (!isWhole && !isOverview && !hasNativeNode) continue;

    if (!schemasToRender.has(rel.source) || !schemasToRender.has(rel.target)) {
      continue;
    }

    const key = `${rel.source}-${rel.target}-${rel.label}`;
    const reverseKey = `${rel.target}-${rel.source}-${rel.label}`;
    if (renderedRelationships.has(key) || renderedRelationships.has(reverseKey)) continue;
    renderedRelationships.add(key);

    let sourceCellId = `field_${rel.source}__id`;
    if (!definedCellIds.has(sourceCellId)) {
      sourceCellId = `table_${rel.source}`;
    }

    const cleanTargetField = rel.label.replace(/[^a-zA-Z0-9_]/g, "_");
    let targetCellId = `field_${rel.target}_${cleanTargetField}`;

    if (!definedCellIds.has(targetCellId)) {
      targetCellId = `table_${rel.target}`;
    }

    if (!definedCellIds.has(sourceCellId) || !definedCellIds.has(targetCellId)) {
      continue;
    }

    const edgeId = `edge_${edgeIdCounter++}`;
    const startArrow = "ERone";
    const endArrow = rel.type === "one-to-one" ? "ERone" : "ERmany";

    const sourceSchema = schemasToRender.get(rel.source);
    const targetSchema = schemasToRender.get(rel.target);
    const sourceModule = sourceSchema ? sourceSchema.moduleName : "shared";
    const targetModule = targetSchema ? targetSchema.moduleName : "shared";
    const isIntraModule = sourceModule === targetModule;

    // Offset multiple relationships between the same pair of entities to prevent overlaps
    const pairKey = sourceCellId < targetCellId ? `${sourceCellId}-${targetCellId}` : `${targetCellId}-${sourceCellId}`;
    const connIndex = pairConnectionCount.get(pairKey) || 0;
    pairConnectionCount.set(pairKey, connIndex + 1);
    
    // Offset connections vertically by 8px
    const offset = connIndex * 8;

    let edgeStyle = "";
    if (isWhole || isOverview) {
      if (isIntraModule && sourceModule && sourceModule !== "shared") {
        edgeStyle = `edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#000000;strokeWidth=2;startArrow=${startArrow};startFill=0;endArrow=${endArrow};endFill=0;fontSize=10;fontColor=#000000;`;
      } else {
        edgeStyle = `edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#000000;strokeWidth=1.5;dashed=1;startArrow=${startArrow};startFill=0;endArrow=${endArrow};endFill=0;fontSize=9;fontColor=#000000;`;
      }
    } else {
      if (isIntraModule) {
        edgeStyle = `edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#000000;strokeWidth=2;startArrow=${startArrow};startFill=0;endArrow=${endArrow};endFill=0;fontSize=10;fontColor=#000000;`;
      } else {
        edgeStyle = `edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#000000;strokeWidth=1.5;dashed=1;startArrow=${startArrow};startFill=0;endArrow=${endArrow};endFill=0;fontSize=9;fontColor=#000000;`;
      }
    }

    if (offset !== 0) {
      edgeStyle += `exitY=0.5;exitDx=0;exitDy=${offset};entryY=0.5;entryDx=0;entryDy=${offset};`;
    }

    xml += `        <mxCell id="${edgeId}" value="${escapeXml(rel.label)}" style="${edgeStyle}" edge="1" parent="1" source="${sourceCellId}" target="${targetCellId}">\n`;
    xml += `          <mxGeometry relative="1" as="geometry" />\n`;
    xml += `        </mxCell>\n`;
  }

  xml += `      </root>\n`;
  xml += `    </mxGraphModel>\n`;
  xml += `  </diagram>\n`;
  xml += `</mxfile>\n`;

  return xml;
}

function buildOverviewDiagram(
  moduleName: string,
  partitionedSchemas: ExtractedSchema[][],
  codeRelations: Relationship[]
): string {
  const allPartitionSchemas: ExtractedSchema[] = [];
  for (const schemas of partitionedSchemas) {
    allPartitionSchemas.push(...schemas);
  }

  const allSchemasMap = new Map<string, ExtractedSchema>();
  for (const s of allPartitionSchemas) {
    allSchemasMap.set(s.name, s);
  }

  const moduleMap = new Map<string, string[]>();
  return buildDrawioDiagram(moduleName, allPartitionSchemas, allSchemasMap, moduleMap, codeRelations, true);
}


function deleteOldMmdFiles(dir: string) {
  if (!fs.existsSync(dir)) return;
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      deleteOldMmdFiles(filePath);
    } else if (file.endsWith(".mmd")) {
      fs.unlinkSync(filePath);
      console.log(`Deleted legacy Mermaid file: ${filePath}`);
    }
  }
}

function getCollectionName(modelName: string): string {
  const lower = modelName.toLowerCase();
  if (lower.endsWith("y")) {
    return lower.slice(0, -1) + "ies";
  }
  if (lower.endsWith("s")) {
    return lower + "es";
  }
  return lower + "s";
}

function extractRelationshipsFromCode(project: Project, allSchemas: ExtractedSchema[]): Relationship[] {
  const codeRelationships: Relationship[] = [];
  const modelToCollectionMap = new Map<string, string>();
  const collectionToModelMap = new Map<string, string>();

  for (const s of allSchemas) {
    const colName = s.collectionName || getCollectionName(s.name);
    modelToCollectionMap.set(s.name, colName);
    collectionToModelMap.set(colName, s.name);
  }

  const findModelByCollection = (coll: string): string | undefined => {
    const cleaned = coll.replace(/['"]/g, "").trim();
    if (collectionToModelMap.has(cleaned)) {
      return collectionToModelMap.get(cleaned);
    }
    const lower = cleaned.toLowerCase();
    for (const [col, model] of collectionToModelMap.entries()) {
      if (col.toLowerCase() === lower) return model;
    }
    return undefined;
  };

  const sourceFiles = project.getSourceFiles();
  for (const sf of sourceFiles) {
    const filePath = sf.getFilePath();
    if (!filePath.includes("src/app/modules")) continue;

    const moduleMatch = filePath.match(/src\/app\/modules\/([^/]+)/);
    if (!moduleMatch) continue;
    const moduleName = moduleMatch[1];

    const nativeSchemas = allSchemas.filter(s => s.moduleName === moduleName);
    if (nativeSchemas.length === 0) continue;
    const primaryModel = nativeSchemas[0].name;

    // Scan for .populate() calls
    const callExprs = sf.getDescendantsOfKind(SyntaxKind.CallExpression);
    for (const call of callExprs) {
      const expr = call.getExpression();
      const exprText = expr.getText();

      if (exprText.endsWith(".populate") || exprText === "populate") {
        const args = call.getArguments();
        if (args.length === 0) continue;

        let sourceModel = primaryModel;
        const chainText = exprText;
        for (const s of nativeSchemas) {
          if (chainText.startsWith(s.name + ".")) {
            sourceModel = s.name;
            break;
          }
        }

        const parsePopulateArg = (arg: Node) => {
          if (Node.isObjectLiteralExpression(arg)) {
            const pathProp = arg.getProperty("path");
            const modelProp = arg.getProperty("model");
            if (pathProp && modelProp) {
              const pathName = pathProp.getText().replace(/['"]/g, "").replace(/path:/, "").trim();
              const targetModel = modelProp.getText().replace(/['"]/g, "").replace(/model:/, "").trim();
              if (targetModel) {
                codeRelationships.push({
                  source: targetModel,
                  target: sourceModel,
                  type: "one-to-many",
                  label: `${pathName} (populate)`
                });
              }
            }
          } else if (Node.isArrayLiteralExpression(arg)) {
            for (const el of arg.getElements()) {
              parsePopulateArg(el);
            }
          }
        };

        for (const arg of args) {
          parsePopulateArg(arg);
        }
      }
    }

    // Scan for $lookup objects
    const objLiterals = sf.getDescendantsOfKind(SyntaxKind.ObjectLiteralExpression);
    for (const obj of objLiterals) {
      const lookupProp = obj.getProperty("$lookup");
      if (lookupProp && Node.isPropertyAssignment(lookupProp)) {
        const init = lookupProp.getInitializer();
        if (init && Node.isObjectLiteralExpression(init)) {
          const fromProp = init.getProperty("from");
          const localFieldProp = init.getProperty("localField");
          const asProp = init.getProperty("as");

          if (fromProp) {
            const fromVal = fromProp.getText().replace(/['"]/g, "").replace(/from:/, "").trim();
            const localFieldVal = localFieldProp ? localFieldProp.getText().replace(/['"]/g, "").replace(/localField:/, "").trim() : "";
            const asVal = asProp ? asProp.getText().replace(/['"]/g, "").replace(/as:/, "").trim() : "";

            const targetModel = findModelByCollection(fromVal);
            if (targetModel) {
              let sourceModel = primaryModel;
              const parentCall = obj.getFirstAncestorByKind(SyntaxKind.CallExpression);
              if (parentCall) {
                const callText = parentCall.getExpression().getText();
                for (const s of nativeSchemas) {
                  if (callText.startsWith(s.name + ".")) {
                    sourceModel = s.name;
                    break;
                  }
                }
              }

              codeRelationships.push({
                source: targetModel,
                target: sourceModel,
                type: "one-to-many",
                label: `${asVal || localFieldVal} ($lookup)`
              });
            }
          }
        }
      }
    }
  }

  return codeRelationships;
}

function validateDrawioXml(xmlContent: string, moduleName: string): string | null {
  try {
    const tags = ["mxfile", "diagram", "mxGraphModel", "root"];
    for (const tag of tags) {
      if (!xmlContent.includes(`<${tag}`) || !xmlContent.includes(`</${tag}>`)) {
        return `Missing XML tag: <${tag}> or </${tag}>`;
      }
    }

    const cellRegex = /<mxCell\s+id="([^"]+)"(?:[^>]*?parent="([^"]+)")?(?:[^>]*?source="([^"]+)")?(?:[^>]*?target="([^"]+)")?(?:[^>]*?edge="1")?/g;
    const cellIds = new Set<string>();
    const parentRefs = new Map<string, string>();
    const edges: { id: string; source: string; target: string; parent: string }[] = [];

    let match;
    cellRegex.lastIndex = 0;
    while ((match = cellRegex.exec(xmlContent)) !== null) {
      const id = match[1];
      const parent = match[2];
      const source = match[3];
      const target = match[4];
      const isEdge = match[0].includes('edge="1"');

      if (cellIds.has(id)) {
        return `Duplicate cell ID detected: "${id}"`;
      }
      cellIds.add(id);

      if (parent) {
        parentRefs.set(id, parent);
      }

      if (isEdge) {
        if (!source || !target) {
          return `Edge cell "${id}" is missing source or target attribute`;
        }
        edges.push({ id, source, target, parent: parent || "1" });
      }
    }

    // Check parent hierarchy
    for (const [id, parent] of parentRefs.entries()) {
      if (id === "0" || id === "1") continue;
      if (!cellIds.has(parent)) {
        return `Cell "${id}" references a parent ID "${parent}" which does not exist`;
      }
    }

    // Check edge source and target exist
    for (const edge of edges) {
      if (!cellIds.has(edge.source)) {
        return `Edge "${edge.id}" references a source ID "${edge.source}" which does not exist (Orphan connector)`;
      }
      if (!cellIds.has(edge.target)) {
        return `Edge "${edge.id}" references a target ID "${edge.target}" which does not exist (Orphan connector)`;
      }
    }

    return null;
  } catch (err: any) {
    return `XML parsing exception: ${err.message}`;
  }
}

function main() {
  console.log("Analyzing project schemas and models using ts-morph AST...");

  const project = new Project({
    tsConfigFilePath: path.resolve(__dirname, "../tsconfig.json")
  });

  const modulesDir = path.resolve(__dirname, "../src/app/modules");
  if (!fs.existsSync(modulesDir)) {
    console.error(`Modules directory not found at: ${modulesDir}`);
    process.exit(1);
  }

  // 1. Scan modules
  const subdirs = fs.readdirSync(modulesDir).filter(f => {
    return fs.statSync(path.join(modulesDir, f)).isDirectory();
  });

  console.log(`Discovered ${subdirs.length} modules.`);

  const allSchemas: ExtractedSchema[] = [];
  const moduleMap = new Map<string, string[]>(); // Map module name to its model names

  for (const moduleName of subdirs) {
    const modulePath = path.join(modulesDir, moduleName);
    const sourceFiles = project.addSourceFilesAtPaths(path.join(modulePath, "**/*.ts"));

    moduleMap.set(moduleName, []);

    for (const sourceFile of sourceFiles) {
      const fileSchemas = analyzeFile(sourceFile, moduleName);
      if (fileSchemas.length > 0) {
        allSchemas.push(...fileSchemas);
        for (const s of fileSchemas) {
          moduleMap.get(moduleName)!.push(s.name);
        }
      }
    }
  }

  // Build a map of all schemas by model name for easy lookup
  const allSchemasMap = new Map<string, ExtractedSchema>();
  for (const s of allSchemas) {
    allSchemasMap.set(s.name, s);
  }

  console.log(`Extracted ${allSchemas.length} models across modules.`);

  // Extract relationships from the query and aggregation code
  console.log("Scanning service and controller source code for .populate() and $lookup relations...");
  const codeRelations = extractRelationshipsFromCode(project, allSchemas);
  console.log(`Extracted ${codeRelations.length} relationships from codebase code parsing.`);

  // 2. Generate ER diagrams for each module
  const outputDir = path.resolve(__dirname, "../docs/erd/modules");
  
  // Clean up legacy .mmd files from previous configurations
  console.log("Cleaning up any old .mmd Mermaid diagrams...");
  deleteOldMmdFiles(outputDir);

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  for (const moduleName of subdirs) {
    const nativeSchemas = allSchemas.filter(s => s.moduleName === moduleName);
    if (nativeSchemas.length === 0) {
      continue; // Skip modules without models
    }

    const moduleOutputDir = path.join(outputDir, moduleName);
    if (!fs.existsSync(moduleOutputDir)) {
      fs.mkdirSync(moduleOutputDir, { recursive: true });
    }

    if (nativeSchemas.length > 15) {
      console.log(`Module "${moduleName}" has ${nativeSchemas.length} entities (> 15). Splitting into sub-diagrams...`);
      const partitions = partitionSchemas(nativeSchemas, codeRelations);
      
      // 1. Generate individual sub-diagrams
      for (let idx = 0; idx < partitions.length; idx++) {
        const subSchemas = partitions[idx];
        const partName = `${moduleName}-part${idx + 1}`;
        const subXml = buildDrawioDiagram(partName, subSchemas, allSchemasMap, moduleMap, codeRelations, false);
        
        const valErr = validateDrawioXml(subXml, partName);
        if (valErr) {
          console.error(`[Validation Failed] Skipping sub-module part "${partName}": ${valErr}`);
          continue;
        }

        const subOutputPath = path.join(moduleOutputDir, `${partName}.drawio`);
        fs.writeFileSync(subOutputPath, subXml, "utf8");
        console.log(`Generated sub-diagram: docs/erd/modules/${moduleName}/${partName}.drawio`);
      }

      // 2. Generate overview diagram
      const overviewXml = buildOverviewDiagram(moduleName, partitions, codeRelations);
      const valErr = validateDrawioXml(overviewXml, `${moduleName}-overview`);
      if (valErr) {
        console.error(`[Validation Failed] Skipping overview for "${moduleName}": ${valErr}`);
      } else {
        const overviewPath = path.join(moduleOutputDir, `${moduleName}-overview.drawio`);
        fs.writeFileSync(overviewPath, overviewXml, "utf8");
        
        // Also write as er-diagram.drawio as the main entry point
        const standardPath = path.join(moduleOutputDir, "er-diagram.drawio");
        fs.writeFileSync(standardPath, overviewXml, "utf8");
        console.log(`Generated overview ER diagram at: docs/erd/modules/${moduleName}/${moduleName}-overview.drawio`);
      }
    } else {
      // Standard single module diagram
      const xmlContent = buildDrawioDiagram(moduleName, nativeSchemas, allSchemasMap, moduleMap, codeRelations, false);
      
      const validationError = validateDrawioXml(xmlContent, moduleName);
      if (validationError) {
        console.error(`[Validation Failed] Skipping module "${moduleName}": ${validationError}`);
        continue;
      }

      const outputPath = path.join(moduleOutputDir, "er-diagram.drawio");
      fs.writeFileSync(outputPath, xmlContent, "utf8");
      console.log(`Generated ER diagram for module "${moduleName}" at: docs/erd/modules/${moduleName}/er-diagram.drawio`);
    }
  }

  // 3. Generate the project-wide (whole) ER diagram
  if (allSchemas.length > 0) {
    const wholeOutputDir = path.join(outputDir, "whole-er-diagram");
    const wholeXmlContent = buildDrawioDiagram("whole-er-diagram", allSchemas, allSchemasMap, moduleMap, codeRelations);
    
    const validationError = validateDrawioXml(wholeXmlContent, "whole-er-diagram");
    if (validationError) {
      console.error(`[Validation Failed] Skipping project-wide diagram: ${validationError}`);
    } else {
      if (!fs.existsSync(wholeOutputDir)) {
        fs.mkdirSync(wholeOutputDir, { recursive: true });
      }
      const wholeOutputPath = path.join(wholeOutputDir, "er-diagram.drawio");
      fs.writeFileSync(wholeOutputPath, wholeXmlContent, "utf8");
      console.log(`Generated project-wide ER diagram at: docs/erd/modules/whole-er-diagram/er-diagram.drawio`);
    }
  }

  console.log("AST schema parsing and Draw.io XML diagram generation completed successfully.");
}

main();
