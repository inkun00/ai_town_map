import "server-only";
import source from "../../docs/contracts/theme-presets.json";
import legacySource from "../../docs/contracts/theme-presets-v1.json";
import type {Theme} from "@/lib/demo-data";

// Historical contracts are available to the API, but are not shipped to every
// browser importing the current emoji catalog.
export const themeVersions=[...legacySource.templates,...source.templates] as Theme[];
