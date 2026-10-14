import registry from "../../content/origins.json";
import type { OriginRegistry } from "./origins";

/** The one registry of who is who, bundled with the site and read by the API too. See content/origins.json for the rules. */
export const REGISTRY = registry as unknown as OriginRegistry;
