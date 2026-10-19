// Runner Builder shares one installed node_modules across every project made
// from this template, linked into the project. Metro follows symlinks, but it
// must also watch the real directory the link points at, or modules resolve to
// files it is not tracking and the bundle fails on the first import.
const { getDefaultConfig } = require("expo/metro-config");
const fs = require("fs");
const path = require("path");

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);

const modules = path.join(projectRoot, "node_modules");
let real = modules;
try {
  real = fs.realpathSync(modules);
} catch {
  /* not installed yet; Metro will say so */
}
if (real !== modules) {
  config.watchFolders = [...(config.watchFolders ?? []), real];
  config.resolver.nodeModulesPaths = [real, ...(config.resolver.nodeModulesPaths ?? [])];
}

module.exports = config;
