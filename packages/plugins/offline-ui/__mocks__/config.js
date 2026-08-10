/**
 * Mock Config for plugin-storage tests (Sprint 4)
 */
const Config = {
    get(key, defaultValue) {
        if (key === "data.profilesBasePath") return defaultValue || "../profiles";
        return defaultValue;
    },
};
export { Config };
