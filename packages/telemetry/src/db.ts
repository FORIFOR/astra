/** DB まわりの再輸出。telemetry から kysely を直接 import しないための薄い層。 */
export { sql } from 'kysely';
export type { ScopedDb } from '@astra/db';
