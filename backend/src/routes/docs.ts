/**
 * OpenAPI 3.0 documentation and interactive Swagger UI.
 */

import type { FastifyInstance } from 'fastify';

export const OPENAPI_SPEC = {
  openapi: '3.0.3',
  info: {
    title: 'AgriShield Networks API',
    description: 'Decentralized parametric crop insurance backend and settlement keeper service on Stellar Soroban',
    version: '0.2.0',
    contact: {
      name: 'AgriShield Networks',
      url: 'https://github.com/AgroShield/AgriShield-Networks',
    },
  },
  servers: [
    {
      url: '/',
      description: 'Current environment API base',
    },
  ],
  paths: {
    '/health': {
      get: {
        summary: 'Check node connectivity and engine contract wiring',
        tags: ['Health & Diagnostics'],
        responses: {
          '200': { description: 'All systems operational' },
          '503': { description: 'Network unreachable or contract address mismatch' },
        },
      },
    },
    '/health/live': {
      get: {
        summary: 'Liveness probe for orchestrators',
        tags: ['Health & Diagnostics'],
        responses: {
          '200': { description: 'Service is live' },
        },
      },
    },
    '/health/ready': {
      get: {
        summary: 'Readiness probe for load balancers',
        tags: ['Health & Diagnostics'],
        responses: {
          '200': { description: 'Service is ready to handle traffic' },
          '503': { description: 'Service is not ready' },
        },
      },
    },
    '/metrics': {
      get: {
        summary: 'Prometheus metrics exposition endpoint',
        tags: ['Health & Diagnostics'],
        responses: {
          '200': { description: 'Prometheus text metrics format' },
        },
      },
    },
    '/policies': {
      get: {
        summary: 'List policies filtered by farmer or region',
        tags: ['Policies'],
        parameters: [
          { name: 'farmer', in: 'query', schema: { type: 'string' }, description: 'Stellar account G...' },
          { name: 'region', in: 'query', schema: { type: 'string' }, description: 'Region symbol, e.g. "US-MW"' },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 }, description: 'Max items to return' },
        ],
        responses: {
          '200': { description: 'Filtered policies list' },
          '400': { description: 'Invalid query parameters' },
        },
      },
    },
    '/policies/{policyId}': {
      get: {
        summary: 'Get details of a specific policy by ID',
        tags: ['Policies'],
        parameters: [
          { name: 'policyId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'Policy details' },
          '404': { description: 'Policy not found' },
        },
      },
    },
    '/policies/{policyId}/settlement': {
      get: {
        summary: 'Simulate settlement evaluation for a policy',
        tags: ['Policies'],
        parameters: [
          { name: 'policyId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'Trigger evaluation outcome' },
          '404': { description: 'Policy not found' },
        },
      },
    },
    '/settlements/{policyId}': {
      post: {
        summary: 'Submit on-chain settlement for an eligible policy',
        tags: ['Settlements'],
        parameters: [
          { name: 'policyId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'x-api-key', in: 'header', required: false, schema: { type: 'string' }, description: 'Optional Keeper API Key' },
        ],
        responses: {
          '200': { description: 'Settlement executed successfully' },
          '401': { description: 'Unauthorized / invalid API key' },
          '503': { description: 'Keeper disabled on this instance' },
        },
      },
    },
    '/settlements/keeper': {
      get: {
        summary: 'Get autonomous keeper status and sweep statistics',
        tags: ['Settlements'],
        responses: {
          '200': { description: 'Keeper execution statistics' },
        },
      },
    },
  },
};

export function registerDocsRoutes(app: FastifyInstance): void {
  app.get('/docs/openapi.json', async (_request, reply) => {
    return reply.code(200).send(OPENAPI_SPEC);
  });

  app.get('/docs', async (_request, reply) => {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>AgriShield Networks - API Docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui.css" />
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🌾</text></svg>">
  <style>
    body { margin: 0; background: #fafafa; font-family: sans-serif; }
    .topbar { display: none; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-bundle.js"></script>
  <script>
    window.onload = () => {
      window.ui = SwaggerUIBundle({
        url: '/docs/openapi.json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIBundle.SwaggerUIStandalonePreset
        ],
        layout: "BaseLayout"
      });
    };
  </script>
</body>
</html>`;
    return reply.type('text/html; charset=utf-8').code(200).send(html);
  });
}
