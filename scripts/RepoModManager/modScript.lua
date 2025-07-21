setExtensionUnloadMode("requiredMods", "manual")
extensions.unload("requiredMods")

setExtensionUnloadMode("repoManager", "manual")
extensions.unload("repoManager")

loadManualUnloadExtensions()
reloadUI()