import type { INestApplication } from '@nestjs/common';
import {
  DocumentBuilder,
  type OpenAPIObject,
  type StandardSchemaConverter,
  SwaggerModule,
} from '@nestjs/swagger';
import * as z from 'zod';
import './components.js';

// Zod writes JSON Schema 2020-12, which OpenAPI 3.1 accepts as is. Named components arrive in
// `$defs`; Nest moves them to `components.schemas` and rewrites the references.
const toOpenApiSchema: StandardSchemaConverter = (schema, { schemaType }) => {
  if (!(schema instanceof z.ZodType)) return undefined;
  const json = z.toJSONSchema(schema, {
    target: 'draft-2020-12',
    io: schemaType,
    unrepresentable: 'any',
  });
  return {
    schema: Object.fromEntries(
      Object.entries(json).filter(([key]) => key !== '$schema' && key !== '$defs'),
    ),
    components: json.$defs,
  };
};

/** The OpenAPI 3.1 document of every route the application has mounted. */
export const buildOpenApiDocument = (app: INestApplication): OpenAPIObject =>
  SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Coworking Admin API')
      .setDescription('REST API of the Coworking Admin frontends.')
      .setVersion('1.0.0')
      .setOpenAPIVersion('3.1.0')
      .addBearerAuth()
      .build(),
    { standardSchemaConverter: toOpenApiSchema },
  );
