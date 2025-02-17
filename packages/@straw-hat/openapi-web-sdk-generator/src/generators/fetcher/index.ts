import * as path from 'path';
import { forEachHttpOperation, getOperationDirectory, getOperationFileRelativePath, formatCode } from '../../helpers';
import { CodegenBase } from '../../codegen-base';
import { camelCase, pascalCase } from 'change-case';
import { OpenAPIV3SchemaObject, OperationObject, PathItemObject } from '../../types';
import { OutputDir } from '../../output-dir';
import { TemplateDir } from '../../template-dir';
import { getTypeDefinition, Scope, toTypeScripType } from '../../engine/to-typescript-type';
import { getParameterSchemaFor, getRequestBodySchema, getResponseSchema } from './helpers';
import { Resolver } from '@stoplight/json-ref-resolver';
import { NEVER_DEFINITION, UNKNOWN_DEFINITION } from './constants';

const templateDir = new TemplateDir(path.join(__dirname, '..', '..', '..', 'templates', 'generators', 'fetcher'));

export interface FetcherCodegenOptions {
  outputDir: string;
}

export default class FetcherCodegen extends CodegenBase<FetcherCodegenOptions> {
  readonly #outputDir: OutputDir;
  readonly #resolver: Resolver;

  constructor(opts: FetcherCodegenOptions) {
    super(opts);
    this.#outputDir = new OutputDir(this.options.outputDir);
    this.#resolver = new Resolver();
  }

  #resolveSchema = (args: { relativeToFilePath: string }) => async (ref: string) => {
    const [components, module] = ref.replace('#/', '').split('/');

    const fromPath = this.#outputDir.resolve(components, module);
    const toPath = path.dirname(args.relativeToFilePath);
    const operationIndexImportPath = path.relative(toPath, fromPath);

    const resolved = await this.#resolver.resolve(this.document, {
      jsonPointer: ref,
    });

    return {
      schema: resolved.result,
      importPath: operationIndexImportPath,
      moduleName: camelCase(module),
    };
  };

  async #processSchema() {
    const schemaFilePath = this.#outputDir.resolve('components/schemas.ts');
    const scope = new Scope({
      resolveSchema: this.#resolveSchema({
        relativeToFilePath: schemaFilePath,
      }),
    });
    const schemas: Record<string, OpenAPIV3SchemaObject> = (this.document.components?.schemas as any) ?? {};

    for (const schemaObject of Object.values(schemas)) {
      await toTypeScripType(scope, schemaObject);
    }

    const formatted = await formatCode(scope.toString(), {
      cwd: schemaFilePath,
    });

    await this.#outputDir.writeFile('components/schemas.ts', formatted);
  }

  #processOperation = async (args: {
    operationMethod: string;
    operationPath: string;
    pathItem: PathItemObject;
    operation: OperationObject;
  }) => {
    const operationDirPath = getOperationDirectory(args.pathItem, args.operation);
    const operationFileRelativePath = getOperationFileRelativePath(operationDirPath, args.operation);
    const operationFilePath = this.#outputDir.resolve(`${operationFileRelativePath}.ts`);

    const operationIndexImportPath = path.relative(
      this.#outputDir.resolveDir('index.ts'),
      this.#outputDir.resolve(operationFileRelativePath)
    );

    const functionName = camelCase(args.operation.operationId);
    const typePrefix = pascalCase(args.operation.operationId);

    const scope = new Scope({
      resolveSchema: this.#resolveSchema({
        relativeToFilePath: operationFilePath,
      }),
    });

    const requestBodySchema = getRequestBodySchema({ operation: args.operation });
    const requestBodyType = requestBodySchema ? await toTypeScripType(scope, requestBodySchema) : NEVER_DEFINITION;

    const pathParamSchema = getParameterSchemaFor({
      pathItem: args.pathItem,
      operation: args.operation,
      inName: 'path',
    });
    const pathParamsType = pathParamSchema ? await toTypeScripType(scope, pathParamSchema) : NEVER_DEFINITION;

    const queryParamSchema = getParameterSchemaFor({
      pathItem: args.pathItem,
      operation: args.operation,
      inName: 'query',
    });
    const queryParamsType = queryParamSchema ? await toTypeScripType(scope, queryParamSchema) : NEVER_DEFINITION;

    const responseSchema = getResponseSchema(args.operation);
    const responseType = responseSchema ? await toTypeScripType(scope, responseSchema) : UNKNOWN_DEFINITION;

    const requiredParams = [
      '"options"',
      requestBodySchema && '"body"',
      pathParamSchema && '"path"',
      queryParamSchema && '"query"',
    ]
      .filter(Boolean)
      .join(' | ');

    await this.#outputDir.createDir(operationDirPath);

    await this.#outputDir.writeFile(
      operationFilePath,
      await templateDir.render('operation-imports.ts.mustache', {
        hasRequestBody: Boolean(requestBodySchema),
      })
    );

    await this.#outputDir.appendFile(operationFilePath, scope.toString());

    await this.#outputDir.appendFile(
      operationFilePath,
      await templateDir.render('operation.ts.mustache', {
        functionName,
        typePrefix,
        operationMethod: args.operationMethod.toUpperCase(),
        operationPath: args.operationPath,
        responseType: getTypeDefinition(responseType),
        pathParamsType: getTypeDefinition(pathParamsType),
        queryParamsType: getTypeDefinition(queryParamsType),
        bodyParamsType: getTypeDefinition(requestBodyType),
        requiredParams,
        hasRequestBody: Boolean(requestBodySchema),
      })
    );

    await this.#outputDir.formatFile(operationFilePath);

    await this.#outputDir.appendFile(
      'index.ts',
      await templateDir.render('index-export-statement.ts.mustache', {
        operationImportPath: operationIndexImportPath,
      })
    );
  };

  async generate() {
    await this.#outputDir.resetDir();
    await this.#outputDir.createDir('components');
    await this.#processSchema();
    await forEachHttpOperation(this.document, this.#processOperation);
    await this.#outputDir.formatFile('index.ts');
  }
}
