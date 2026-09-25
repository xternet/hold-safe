import { ApiHandler } from "./_2_handler/mod";
import type { ApiOptions } from "./_shared/mod";
export function createApi(options: ApiOptions): ApiHandler { return new ApiHandler(options); }
export { startApi } from "./_3_listener/mod";
