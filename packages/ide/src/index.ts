/**
 * FeatureMap IDE service entry (Phase 6 / ADR-0008).
 *
 * `featuremap ide` runs the headless service over stdio JSON-RPC so
 * editor extensions can spawn it per-workspace and own its lifecycle —
 * no HTTP port, no manual server start.
 */
export { createIdeService } from './service.js';
export type { IdeServiceOptions, ProjectStatus, FeatureSummary, FeatureDetail, IdeHandler, IdeService } from './service.js';
export {
  serveRpc,
  parseRequestLine,
  encodeResponse,
  RpcError,
  RpcErrorCode,
  DomainErrorCode,
} from './rpc.js';
export type { RpcRequest, RpcSuccessResponse, RpcErrorResponse, RpcHandler, RpcWriter, RpcId } from './rpc.js';
import { createIdeService, type IdeServiceOptions } from './service.js';
import { serveRpc } from './rpc.js';

/** Run the IDE service over process stdio until stdin closes. */
export function startIdeStdio(options: IdeServiceOptions): Promise<void> {
  const service = createIdeService(options);
  return serveRpc(service.handlers, process.stdin, process.stdout);
}
