local function checkForMod(modID)
    local mods = core_modmanager.getMods()
    
    for _, mod in pairs(mods) do
        if mod.modID == modID then
            if not mod.active then
                core_modmanager.activateModId(mod.modID)
            end
            return
        end
    end
    core_repository.modSubscribe(modID)
end

checkForMod("M6CZKT7NV")

setExtensionUnloadMode("requiredMods", "manual")
extensions.unload("requiredMods")

setExtensionUnloadMode("repoManager", "manual")
extensions.unload("repoManager")

loadManualUnloadExtensions()
reloadUI()