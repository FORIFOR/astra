/**
 * Fastify のインスタンス型。
 *
 * `loggerInstance` に pino の Logger を渡すと、Fastify のジェネリクスが
 * `FastifyBaseLogger` ではなく pino の `Logger` で固定される。
 * 各所で素の `FastifyInstance` を書くと型が合わなくなるので、別名を 1 つに固定する。
 */
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';
import type { Logger } from '@astra/telemetry';

export type App = FastifyInstance<Server, IncomingMessage, ServerResponse, Logger>;
