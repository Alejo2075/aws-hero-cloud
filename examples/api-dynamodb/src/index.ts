import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import Fastify from 'fastify';

const table = process.env.TABLE_NAME;
const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const app = Fastify();

app.get('/health', async () => ({ ok: true }));

app.get('/orders/:id', async (request) => {
  const { id } = request.params as { id: string };
  const result = await client.send(new GetCommand({ TableName: table, Key: { id } }));
  return result.Item ?? {};
});

await app.listen({ port: 4000, host: '0.0.0.0' });
