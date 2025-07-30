local M = {}

local packData = {}
local modRequestQueue = {}
local isProcessingQueue = false
local REQUEST_DELAY = 0.1
local modDataCache = {}
local CACHE_EXPIRY_TIME = 300

local function tableKeys(t)
    local keys = {}
    for k, _ in pairs(t) do
        table.insert(keys, k)
    end
    return keys
end

local function isModCached(modId)
    if not modDataCache[modId] then
        return false
    end
    
    local currentTime = os.time()
    local cacheAge = currentTime - modDataCache[modId].cacheTime
    
    if cacheAge > CACHE_EXPIRY_TIME then
        modDataCache[modId] = nil
        log('D', 'repoManager', 'Cache expired for mod: ' .. modId)
        return false
    end
    
    return true
end

local function getCachedMod(modId)
    if isModCached(modId) then
        log('D', 'repoManager', 'Using cached data for mod: ' .. modId)
        return modDataCache[modId].data
    end
    return nil
end

local function cacheModData(modId, data)
    modDataCache[modId] = {
        data = data,
        cacheTime = os.time()
    }
    log('D', 'repoManager', 'Cached data for mod: ' .. modId)
end

local function processModRequestQueue()
    if isProcessingQueue or #modRequestQueue == 0 then
        return
    end
    
    isProcessingQueue = true
    local modId = table.remove(modRequestQueue, 1)
    
    log('D', 'repoManager', 'Processing mod request: ' .. modId)
    
    local cachedData = getCachedMod(modId)
    if cachedData then
        guihooks.trigger('ModReceived', cachedData)
        
        if #modRequestQueue > 0 then
            isProcessingQueue = false
            processModRequestQueue()
        else
            isProcessingQueue = false
        end
        return
    end
    
    local modname = core_modmanager.getModNameFromID(modId)
    if modname then
        local mdb = core_modmanager.getModDB(modname)
        if mdb and mdb.modData then
            local data = {}
            data.data = mdb.modData
            data.localMod = mdb
            data.ok = 1
            
            local iconPath = "mod_info/"..modId.."/icon.jpg"
            if FS:fileExists(iconPath) then
                data.data.isLocal = true
                local fileUrl = "file://" .. iconPath:gsub("\\", "/")
                
                data.data.localIconPath = iconPath
                data.data.localIconPathAlt = fileUrl
                
                log('D', 'repoManager', 'Using relative path: ' .. data.data.localIconPath)
            else
                log('D', 'repoManager', 'No local icon for: ' .. modId)
            end
            
            if mdb.active then
                data.data.sub = true
                data.data.subscribed = true
                log('D', 'repoManager', 'Mod ' .. modId .. ' is currently active')
            else
                data.data.sub = false
                data.data.subscribed = false
                log('D', 'repoManager', 'Mod ' .. modId .. ' is inactive')
            end
            
            data.data.pending = false
            data.data.unpacked = not mdb.fullpath:find("%.zip$")
            data.data.downState = false
            data.data.updatingRepo = false
            data.data.metered = not Engine.Platform.isNetworkUnrestricted()
            
            cacheModData(modId, data)
            
            guihooks.trigger('ModReceived', data)
            
            if #modRequestQueue > 0 then
                isProcessingQueue = false
                processModRequestQueue()
            else
                isProcessingQueue = false
            end
            return
        end
    end
    
    if settings.getValue('onlineFeatures') ~= 'enable' then
        local modname = core_modmanager.getModNameFromID(modId)
        if modname then
            local mdb = core_modmanager.getModDB(modname)
            if mdb and mdb.modData then
                local data = {}
                data.data = mdb.modData
                data.localMod = mdb
                data.ok = 1
                guihooks.trigger('ModReceived', data)
            end
        end
        
        if #modRequestQueue > 0 then
            core_jobsystem.create( function(job)
                job.sleep(REQUEST_DELAY)
                isProcessingQueue = false
                processModRequestQueue()
            end)
        else
            isProcessingQueue = false
        end
        return
    end
    
    core_online.apiCall('s1/v4/getMod/'..modId, function(request)
        if request.responseData == nil then
            log('W', 'repoManager', 'Server Error for mod: ' .. modId)
        else
            request.responseData.data.message = string.gsub(request.responseData.data.message or "", "\n", "<br>")
            request.responseData.data.pending = false
            request.responseData.data.unpacked = core_modmanager.modIsUnpacked(request.responseData.data.filename or "")
            request.responseData.data.downState = false
            request.responseData.updatingRepo = false
            request.responseData.metered = not Engine.Platform.isNetworkUnrestricted()
            
            cacheModData(modId, request.responseData)
            
            guihooks.trigger('ModReceived', request.responseData)
        end
        
        if #modRequestQueue > 0 then
            core_jobsystem.create( function(job)
                job.sleep(REQUEST_DELAY)
                isProcessingQueue = false
                processModRequestQueue()
            end)
        else
            isProcessingQueue = false
        end
    end)
end

local function requestModWithDelay(modId)
    log('D', 'repoManager', 'Queueing mod request: ' .. modId)
    table.insert(modRequestQueue, modId)
    
    if not isProcessingQueue then
        processModRequestQueue()
    end
end

local function requestMultipleMods(modIds)
    log('D', 'repoManager', 'Queueing ' .. #modIds .. ' mod requests')
    
    modRequestQueue = {}
    
    for _, modId in ipairs(modIds) do
        table.insert(modRequestQueue, modId)
    end
    
    if not isProcessingQueue then
        processModRequestQueue()
    end
end

local function checkAllPackStatuses()
    local packStatuses = {}
    
    -- Get pending packs from requiredMods
    local pendingPacks = extensions.requiredMods.getPendingPacks()
    local pendingPacksSet = {}
    for _, packName in ipairs(pendingPacks) do
        pendingPacksSet[packName] = true
    end
    
    for directory, pData in pairs(packData) do
        if pData.requiredMods then
            local activeCount = 0
            local totalCount = 0
            local activeMods = {}
            local inactiveMods = {}

            if pData.requiredMods.modIds then
                totalCount = #pData.requiredMods.modIds
                for _, modId in ipairs(pData.requiredMods.modIds) do
                    local modName = core_modmanager.getModNameFromID(modId)
                    
                    if modName then
                        local modData = core_modmanager.getModDB(modName)
                        if modData and modData.active then
                            activeCount = activeCount + 1
                            table.insert(activeMods, modId)
                        else
                            table.insert(inactiveMods, modId)
                        end
                    else
                        table.insert(inactiveMods, modId)
                    end
                end
            end

            if pData.requiredMods.modNames then
                totalCount = totalCount + #pData.requiredMods.modNames
                for _, modName in ipairs(pData.requiredMods.modNames) do
                    local modData = core_modmanager.getModDB(modName)
                    if modData and modData.active then
                        activeCount = activeCount + 1
                        table.insert(activeMods, modName)
                    else
                        table.insert(inactiveMods, modName)
                    end
                end
            end
            
            local isPackActive = activeCount > 0
            local isPackFullyActive = activeCount == totalCount
            local isPending = pendingPacksSet[pData.packName] == true
            
            packStatuses[pData.packName] = {
                packName = pData.packName,
                directory = directory,
                activeCount = activeCount,
                totalCount = totalCount,
                isPackActive = isPackActive,
                isPackFullyActive = isPackFullyActive,
                isPending = isPending,
                activeMods = activeMods,
                inactiveMods = inactiveMods
            }
            
            local statusText = activeCount .. '/' .. totalCount .. ' active'
            if isPending then
                statusText = statusText .. ' (pending)'
            end
            log('D', 'repoManager', 'Pack: ' .. pData.packName .. ' - ' .. statusText)
        end
    end
    
    return packStatuses
end

local function loadDependencies()
    packData = {}
    local directories = FS:findFiles('/dependencies/', "*", 0, false, true)
    for _, directory in ipairs(directories) do
        
        local requiredModsFile = io.open(directory .. "/requiredMods.json", "r")
        if requiredModsFile then
            local requiredModsData = jsonDecode(requiredModsFile:read("*all"))
            requiredModsFile:close()
            local infoFile = io.open(directory .. "/info.json", "r")
            if infoFile then
                local infoData = jsonDecode(infoFile:read("*all"))
                if infoData.preview then
                    infoData.previewPath = directory .. "/" .. infoData.preview
                end
                local folderName = directory:match("([^/]+)$")
                packData[directory] = {
                    packName = folderName,
                    requiredMods = requiredModsData,
                    info = infoData
                }
                log('D', 'repoManager', 'Loaded pack: ' .. folderName .. ' from directory: ' .. directory)
                infoFile:close()
            end
        end
    end
    
    local packStatuses = checkAllPackStatuses()
    
    -- Get mod-to-pack association data
    local modToPacks = M.getModToPacks()
    local baseMod = M.getBaseMod()
    
    -- Create pack-to-mod mapping for the frontend
    local packToMod = {}
    for modName, packs in pairs(modToPacks) do
        for _, packName in ipairs(packs) do
            packToMod[packName] = modName
        end
    end
    
    log('D', 'repoManager', 'SENDING DependenciesLoaded with ' .. #tableKeys(packData or {}) .. ' packs')
    guihooks.trigger('DependenciesLoaded', packData)
    
    log('D', 'repoManager', 'SENDING PackStatusesLoaded with ' .. #tableKeys(packStatuses or {}) .. ' pack statuses')
    guihooks.trigger('PackStatusesLoaded', packStatuses)
    
    -- Send mod association data
    local modAssociationData = {
        packToMod = packToMod,
        baseMod = baseMod,
        modToPacks = modToPacks
    }
    log('D', 'repoManager', 'SENDING ModAssociationLoaded with pack-to-mod mapping')
    guihooks.trigger('ModAssociationLoaded', modAssociationData)
end

local function sendPackStatuses()
    local packStatuses = checkAllPackStatuses()
    log('D', 'repoManager', 'SENDING PackStatusesLoaded with ' .. #tableKeys(packStatuses or {}) .. ' pack statuses')
    guihooks.trigger('PackStatusesLoaded', packStatuses)
end

local function sendSubscriptionStatus()
    if requiredMods and requiredMods.getSubscriptionStatus then
        local status = requiredMods.getSubscriptionStatus()
        guihooks.trigger('subscriptionStatusUpdate', status)
    end
end

local function clearModCache()
    modDataCache = {}
    log('D', 'repoManager', 'Mod cache cleared')
end

local function getCacheInfo()
    local cacheSize = 0
    local expiredCount = 0
    local currentTime = os.time()
    
    for modId, cacheEntry in pairs(modDataCache) do
        cacheSize = cacheSize + 1
        local cacheAge = currentTime - cacheEntry.cacheTime
        if cacheAge > CACHE_EXPIRY_TIME then
            expiredCount = expiredCount + 1
        end
    end
    
    return {
        totalCached = cacheSize,
        expiredEntries = expiredCount,
        expiryTime = CACHE_EXPIRY_TIME
    }
end

-- Helper function to normalize file paths
local function normalizePath(path)
    if not path then return "" end
    path = path:gsub("\\", "/")
    path = path:gsub("//+", "/")
    if not path:startswith("/") then
        path = "/" .. path
    end
    return path
end

-- Helper function to get files from a ZIP archive
local function getZipFileMap(zipPath)
    local zip = ZipArchive()
    local fileMap = {}
    
    if zip:openArchiveName(zipPath, "R") then
        local fileList = zip:getFileList()
        for i, f in ipairs(fileList) do
            fileMap[f] = i
        end
        zip:close()
    end
    
    return fileMap
end

-- Get all active mods
local function getActiveMods()    
    local activeMods = {}
    local allMods = core_modmanager.getMods()
    
    if not allMods then
        return {}
    end
    
    for modName, modData in pairs(allMods) do
        if modData.active then
            activeMods[modName] = modData
        end
    end
    
    return activeMods
end

-- Get files from a specific mod (handles both unpacked and ZIP mods)
local function getModFiles(modData, modName)
    local files = {}
    
    -- For mods with hash data (most common)
    if modData.modData and modData.modData.hashes then
        for _, hashData in ipairs(modData.modData.hashes) do
            local filePath = normalizePath(hashData[1])
            table.insert(files, filePath)
        end
    -- For unpacked mods
    elseif modData.unpackedPath and FS:directoryExists(modData.unpackedPath) then
        local modFiles = FS:findFiles(modData.unpackedPath, '*', -1, true, false)
        for _, fullPath in ipairs(modFiles) do
            local relativePath = fullPath:gsub(modData.unpackedPath, "")
            relativePath = normalizePath(relativePath)
            table.insert(files, relativePath)
        end
    -- For ZIP-based mods
    elseif modData.fullpath and FS:fileExists(modData.fullpath) then
        local zipFileMap = getZipFileMap(modData.fullpath)
        for filePath, _ in pairs(zipFileMap) do
            local normalized = normalizePath(filePath)
            table.insert(files, normalized)
        end
    end
    
    return files
end

-- Main function to map mods to their dependency packs
local function getModToPacks()
    local activeMods = getActiveMods()
    local modToPacks = {}
    
    for modName, modData in pairs(activeMods) do
        local modFiles = getModFiles(modData, modName)
        local dependencyPacks = {}
        
        -- Look for files in dependencies directories
        for _, filePath in ipairs(modFiles) do
            -- Check if this file is in a dependencies directory
            local dependenciesMatch = filePath:match("^/dependencies/([^/]+)/")
            if dependenciesMatch then
                -- Check if this is a pack directory with required files
                local hasInfo = false
                local hasRequiredMods = false
                
                for _, checkPath in ipairs(modFiles) do
                    if checkPath == "/dependencies/" .. dependenciesMatch .. "/info.json" then
                        hasInfo = true
                    elseif checkPath == "/dependencies/" .. dependenciesMatch .. "/requiredMods.json" then
                        hasRequiredMods = true
                    end
                end
                
                -- If both required files exist, this is a valid pack
                if hasInfo and hasRequiredMods then
                    if not dependencyPacks[dependenciesMatch] then
                        dependencyPacks[dependenciesMatch] = true
                        log('D', 'repoManager', 'Found pack "' .. dependenciesMatch .. '" in mod: ' .. modName)
                    end
                end
            end
        end
        
        -- Only add mods that have at least one pack
        local packList = tableKeys(dependencyPacks)
        if #packList > 0 then
            modToPacks[modName] = packList
            log('D', 'repoManager', 'Mod ' .. modName .. ' has ' .. #packList .. ' packs: ' .. table.concat(packList, ', '))
        end
    end
    
    return modToPacks
end

local function findModContainingFile(targetFile)
    local activeMods = getActiveMods()
    local containingMods = {}
    
    local normalizedTarget = normalizePath(targetFile)
    
    for modName, modData in pairs(activeMods) do
        local modFiles = getModFiles(modData, modName)
        for _, filePath in ipairs(modFiles) do
            if filePath == normalizedTarget then
                table.insert(containingMods, {
                    modName = modName,
                    isActive = true,
                    isZipped = modData.fullpath ~= nil,
                    modPath = modData.unpackedPath or modData.fullpath
                })
                log('D', 'repoManager', 'File "' .. targetFile .. '" found in active mod: ' .. modName)
                break -- Found in this mod, move to next mod
            end
        end
    end
    
    return containingMods
end

local function getFileOwnerMod(targetFile)
    local containingMods = findModContainingFile(targetFile)
    
    if #containingMods > 0 then
        if #containingMods > 1 then
            log('W', 'repoManager', 'File "' .. targetFile .. '" found in multiple mods: ' .. 
                table.concat(tableKeys(containingMods), ', ') .. '. Returning first active mod.')
        end
        return containingMods[1].modName
    end
    
    return nil
end

local function isFileInAnyMod(targetFile)
    local containingMods = findModContainingFile(targetFile)
    return #containingMods > 0
end

local function getBaseMod()
    return getFileOwnerMod("lua/ge/repoManager.lua")
end

-- Get all available mods from core_modmanager
local function getAllAvailableMods()
    local availableMods = {}
    
    if not core_modmanager then
        log('W', 'repoManager', 'core_modmanager not available')
        return {}
    end
    
    local allMods = core_modmanager.getMods()
    if not allMods then
        log('W', 'repoManager', 'No mods found in core_modmanager')
        return {}
    end
    
    for modName, modData in pairs(allMods) do
        if modData and modData.modData then
            local modInfo = {
                modname = modName,
                name = modData.modData.name or modName,
                title = modData.modData.title,
                tagid = modData.modData.tagid,
                author = modData.modData.author or modData.modData.creator,
                version = modData.modData.version,
                description = modData.modData.description,
                active = modData.active or false,
                fullpath = modData.fullpath,
                dirname = modData.dirname
            }
            
            -- Add icon path using the same method as modmanager
            if modData.modInfoPath then
                local iconPath = modData.modInfoPath .. "icon.jpg"
                if FS:fileExists(iconPath) then
                    modInfo.iconPath = iconPath
                    modInfo.hasIcon = true
                else
                    modInfo.hasIcon = false
                end
            else
                modInfo.hasIcon = false
            end
            
            -- Only include mods that have some identification
            if modInfo.tagid or modInfo.modname then
                table.insert(availableMods, modInfo)
            end
        elseif modData then
           
            local modInfo = {
                modname = modName,
                name = modName,
                title = nil,
                tagid = nil,
                author = nil,
                version = nil,
                description = "Mod without metadata",
                active = modData.active or false,
                fullpath = modData.fullpath,
                dirname = modData.dirname,
                hasModData = false
            }
            
            if modData.modInfoPath then
                local iconPath = modData.modInfoPath .. "icon.jpg"
                if FS:fileExists(iconPath) then
                    modInfo.iconPath = iconPath
                    modInfo.hasIcon = true
                else
                    modInfo.hasIcon = false
                end
            else
                modInfo.hasIcon = false
            end
            
            table.insert(availableMods, modInfo)
        else
            log('W', 'repoManager', 'Mod ' .. tostring(modName) .. ' has no valid data structure')
        end
    end
    
    -- Sort by name for better user experience
    table.sort(availableMods, function(a, b)
        local nameA = a.name or a.modname or ""
        local nameB = b.name or b.modname or ""
        return nameA:lower() < nameB:lower()
    end)
    
    log('D', 'repoManager', 'Found ' .. #availableMods .. ' available mods')
    return availableMods
end

-- Create a custom pack with the provided data
local function createCustomPack(packDataJson)
    local success, packData = pcall(jsonDecode, packDataJson)
    if not success then
        log('E', 'repoManager', 'Failed to parse pack data JSON: ' .. tostring(packData))
        guihooks.trigger('CustomPackCreated', { success = false, error = 'Invalid pack data' })
        return false
    end
    
    -- Validate required fields
    if not packData.name or packData.name == "" then
        log('E', 'repoManager', 'Pack name is required')
        guihooks.trigger('CustomPackCreated', { success = false, error = 'Pack name is required' })
        return false
    end
    
    -- Sanitize pack name for directory creation
    local packName = packData.name:gsub("[^%w%s%-_]", ""):gsub("%s+", "_")
    if packName == "" then
        log('E', 'repoManager', 'Invalid pack name after sanitization')
        guihooks.trigger('CustomPackCreated', { success = false, error = 'Invalid pack name' })
        return false
    end
    
    local packDir = "/dependencies/" .. packName
    
    -- Check if pack already exists
    if FS:directoryExists(packDir) then
        log('E', 'repoManager', 'Pack already exists: ' .. packName)
        guihooks.trigger('CustomPackCreated', { success = false, error = 'Pack with this name already exists' })
        return false
    end
    
    -- Create the pack directory
    if not FS:directoryCreate(packDir) then
        log('E', 'repoManager', 'Failed to create pack directory: ' .. packDir)
        guihooks.trigger('CustomPackCreated', { success = false, error = 'Failed to create pack directory' })
        return false
    end
    
    -- Create requiredMods.json
    local requiredMods = {
        modIds = packData.modIds or {},
        modNames = packData.modNames or {}
    }
    
    local requiredModsFile = io.open(packDir .. "/requiredMods.json", "w")
    if not requiredModsFile then
        log('E', 'repoManager', 'Failed to create requiredMods.json')
        FS:directoryRemove(packDir) -- Cleanup
        guihooks.trigger('CustomPackCreated', { success = false, error = 'Failed to create requiredMods.json' })
        return false
    end
    
    requiredModsFile:write(jsonEncode(requiredMods))
    requiredModsFile:close()
    
    -- Create info.json
    local info = {
        name = packData.name,
        description = packData.description or "Custom pack created by user",
        preview = "image.png",
        order = 999 -- Custom packs go at the end
    }
    
    local infoFile = io.open(packDir .. "/info.json", "w")
    if not infoFile then
        log('E', 'repoManager', 'Failed to create info.json')
        FS:directoryRemove(packDir) -- Cleanup
        guihooks.trigger('CustomPackCreated', { success = false, error = 'Failed to create info.json' })
        return false
    end
    
    infoFile:write(jsonEncode(info))
    infoFile:close()
    
    -- Copy default image if it doesn't exist
    local defaultImagePath = "/ui/modModules/repoManager/icons/default-pack.png"
    local packImagePath = packDir .. "/image.png"
    
    if FS:fileExists(defaultImagePath) then
        FS:copyFile(defaultImagePath, packImagePath)
    end
    
    log('I', 'repoManager', 'Successfully created custom pack: ' .. packName .. ' with ' .. 
        (#requiredMods.modIds + #requiredMods.modNames) .. ' mods')
    
    guihooks.trigger('CustomPackCreated', { success = true, packName = packName })
    return true
end

-- Load pack data for editing
local function loadPackForEdit(packName)
    local packDir = "/dependencies/" .. packName
    
    if not FS:directoryExists(packDir) then
        log('E', 'repoManager', 'Pack directory not found: ' .. packDir)
        guihooks.trigger('PackLoadedForEdit', { success = false, error = 'Pack not found' })
        return false
    end
    
    -- Read info.json
    local infoFile = io.open(packDir .. "/info.json", "r")
    if not infoFile then
        log('E', 'repoManager', 'Failed to read info.json for pack: ' .. packName)
        guihooks.trigger('PackLoadedForEdit', { success = false, error = 'Failed to read pack info' })
        return false
    end
    
    local infoContent = infoFile:read("*all")
    infoFile:close()
    
    local success, infoData = pcall(jsonDecode, infoContent)
    if not success then
        log('E', 'repoManager', 'Failed to parse info.json for pack: ' .. packName)
        guihooks.trigger('PackLoadedForEdit', { success = false, error = 'Invalid pack info format' })
        return false
    end
    
    -- Read requiredMods.json
    local requiredModsFile = io.open(packDir .. "/requiredMods.json", "r")
    if not requiredModsFile then
        log('E', 'repoManager', 'Failed to read requiredMods.json for pack: ' .. packName)
        guihooks.trigger('PackLoadedForEdit', { success = false, error = 'Failed to read pack mods' })
        return false
    end
    
    local requiredModsContent = requiredModsFile:read("*all")
    requiredModsFile:close()
    
    local success, requiredModsData = pcall(jsonDecode, requiredModsContent)
    if not success then
        log('E', 'repoManager', 'Failed to parse requiredMods.json for pack: ' .. packName)
        guihooks.trigger('PackLoadedForEdit', { success = false, error = 'Invalid pack mods format' })
        return false
    end
    
    -- Ensure arrays are properly formatted for JavaScript
    local modIds = requiredModsData.modIds or {}
    local modNames = requiredModsData.modNames or {}
    
    -- Convert to proper arrays if they're not already
    if type(modIds) == "table" then
        local modIdsArray = {}
        for _, modId in pairs(modIds) do
            table.insert(modIdsArray, modId)
        end
        modIds = modIdsArray
    end
    
    if type(modNames) == "table" then
        local modNamesArray = {}
        for _, modName in pairs(modNames) do
            table.insert(modNamesArray, modName)
        end
        modNames = modNamesArray
    end
    
    local packData = {
        name = infoData.name,
        description = infoData.description,
        modIds = modIds,
        modNames = modNames
    }
    
    log('I', 'repoManager', 'Successfully loaded pack for editing: ' .. packName)
    log('D', 'repoManager', 'Pack data being sent: modIds count=' .. #modIds .. ', modNames count=' .. #modNames)
    guihooks.trigger('PackLoadedForEdit', { success = true, pack = packData })
    return true
end

-- Update an existing custom pack
local function updateCustomPack(packDataJson)
    local success, packData = pcall(jsonDecode, packDataJson)
    if not success then
        log('E', 'repoManager', 'Failed to parse pack data JSON: ' .. tostring(packData))
        guihooks.trigger('CustomPackCreated', { success = false, error = 'Invalid pack data' })
        return false
    end
    
    -- Validate required fields
    if not packData.originalName or packData.originalName == "" then
        log('E', 'repoManager', 'Original pack name is required for update')
        guihooks.trigger('CustomPackCreated', { success = false, error = 'Original pack name required' })
        return false
    end
    
    if not packData.name or packData.name == "" then
        log('E', 'repoManager', 'Pack name is required')
        guihooks.trigger('CustomPackCreated', { success = false, error = 'Pack name is required' })
        return false
    end
    
    local originalPackDir = "/dependencies/" .. packData.originalName
    
    if not FS:directoryExists(originalPackDir) then
        log('E', 'repoManager', 'Original pack not found: ' .. packData.originalName)
        guihooks.trigger('CustomPackCreated', { success = false, error = 'Original pack not found' })
        return false
    end
    
    -- Sanitize new pack name
    local newPackName = packData.name:gsub("[^%w%s%-_]", ""):gsub("%s+", "_")
    if newPackName == "" then
        log('E', 'repoManager', 'Invalid pack name after sanitization')
        guihooks.trigger('CustomPackCreated', { success = false, error = 'Invalid pack name' })
        return false
    end
    
    local newPackDir = "/dependencies/" .. newPackName
    
    -- If name changed, check if new name conflicts
    if newPackName ~= packData.originalName and FS:directoryExists(newPackDir) then
        log('E', 'repoManager', 'Pack with new name already exists: ' .. newPackName)
        guihooks.trigger('CustomPackCreated', { success = false, error = 'Pack with this name already exists' })
        return false
    end
    
    -- Update requiredMods.json
    local requiredMods = {
        modIds = packData.modIds or {},
        modNames = packData.modNames or {}
    }
    
    local requiredModsFile = io.open(originalPackDir .. "/requiredMods.json", "w")
    if not requiredModsFile then
        log('E', 'repoManager', 'Failed to update requiredMods.json')
        guihooks.trigger('CustomPackCreated', { success = false, error = 'Failed to update pack mods' })
        return false
    end
    
    requiredModsFile:write(jsonEncode(requiredMods))
    requiredModsFile:close()
    
    -- Update info.json
    local info = {
        name = packData.name,
        description = packData.description or "Custom pack created by user",
        preview = "image.png",
        order = 999
    }
    
    local infoFile = io.open(originalPackDir .. "/info.json", "w")
    if not infoFile then
        log('E', 'repoManager', 'Failed to update info.json')
        guihooks.trigger('CustomPackCreated', { success = false, error = 'Failed to update pack info' })
        return false
    end
    
    infoFile:write(jsonEncode(info))
    infoFile:close()
    
    -- If name changed, rename the directory
    if newPackName ~= packData.originalName then
        -- Create the new directory
        if not FS:directoryCreate(newPackDir) then
            log('E', 'repoManager', 'Failed to create new pack directory: ' .. newPackName)
            guihooks.trigger('CustomPackCreated', { success = false, error = 'Failed to create new pack directory' })
            return false
        end
        
        -- Find all files in the original directory
        local files = FS:findFiles(originalPackDir, "*", -1, true, false)
        if files then
            -- Copy each file to the new directory
            for _, file in ipairs(files) do
                local relativePath = file:sub(#originalPackDir + 2) -- Remove original path + "/"
                local newFilePath = newPackDir .. "/" .. relativePath
                
                if not FS:copyFile(originalPackDir .. "/" .. relativePath, newFilePath) then
                    log('E', 'repoManager', 'Failed to copy file: ' .. relativePath)
                    FS:directoryRemove(newPackDir) -- Cleanup new directory
                    guihooks.trigger('CustomPackCreated', { success = false, error = 'Failed to copy pack files' })
                    return false
                end
            end
        end
        
        -- Remove the original directory
        if not FS:directoryRemove(originalPackDir) then
            log('E', 'repoManager', 'Failed to remove original pack directory: ' .. packData.originalName)
            -- Don't fail completely as files are already copied
            log('W', 'repoManager', 'Pack renamed but original directory could not be removed')
        end
        
        log('I', 'repoManager', 'Renamed pack directory from ' .. packData.originalName .. ' to ' .. newPackName)
    end
    
    log('I', 'repoManager', 'Successfully updated custom pack: ' .. newPackName .. ' with ' .. 
        (#requiredMods.modIds + #requiredMods.modNames) .. ' mods')
    
    guihooks.trigger('CustomPackCreated', { success = true, packName = newPackName })
    return true
end

-- Repository mod request function with detailed logging
local function requestRepositoryMods(args)
    log('I', 'repoManager', 'Starting repository mod request')
    
    -- Handle case where args is passed as a table (from bngApi.serializeToLua)
    local query, orderBy, order, page, categories
    if type(args) == 'table' and #args > 0 then
        query = args[1]
        orderBy = args[2]
        order = args[3]
        page = args[4]
        categories = args[5]
    else
        -- Fallback for direct calls
        query = args
        orderBy = nil
        order = nil
        page = nil
        categories = nil
    end
    
    log('D', 'repoManager', '  query: ' .. tostring(query or 'nil'))
    log('D', 'repoManager', '  orderBy: ' .. tostring(orderBy or 'nil'))
    log('D', 'repoManager', '  order: ' .. tostring(order or 'nil'))
    log('D', 'repoManager', '  page: ' .. tostring(page or 'nil'))
    log('D', 'repoManager', '  categories type: ' .. type(categories))
    
    if categories then
        if type(categories) == 'table' then
            log('D', 'repoManager', '  categories count: ' .. #categories)
            for i, cat in ipairs(categories) do
                log('D', 'repoManager', '    category[' .. i .. ']: ' .. tostring(cat))
            end
        else
            log('D', 'repoManager', '  categories value: ' .. tostring(categories))
        end
    end
    
    -- Check if online features are enabled
    if settings.getValue('onlineFeatures') ~= 'enable' then
        log('W', 'repoManager', 'Online features are disabled')
        guihooks.trigger('ModListReceived', { 
            data = {}, 
            count = 0, 
            error = 'Online features are disabled' 
        })
        return
    end
    
    -- Check if network is available
    if not Engine.Platform.isNetworkUnrestricted() then
        log('W', 'repoManager', 'Network is metered or restricted!')
    end
    
    -- Check if user is authenticated
    if not Engine.Online.isAuthenticated() then
        log('W', 'repoManager', 'User is not authenticated')
        guihooks.trigger('ModListReceived', { 
            data = {}, 
            count = 0, 
            error = 'User is not authenticated' 
        })
        return
    end
    
    log('I', 'repoManager', 'Making API call to s1/v4/getMods')
    
    -- Make the API call using the same format as the base game
    core_online.apiCall('s1/v4/getMods', function(request)
        log('I', 'repoManager', 'API call completed')
        log('D', 'repoManager', '  responseCode: ' .. tostring(request.responseCode or 'nil'))
        log('D', 'repoManager', '  responseData: ' .. tostring(request.responseData and 'present' or 'nil'))
        
        if request.responseCode then
            log('D', 'repoManager', '  HTTP response code: ' .. request.responseCode)
        end
        
        if request.responseBuffer then
            log('D', 'repoManager', '  Response buffer length: ' .. #tostring(request.responseBuffer))
            log('D', 'repoManager', '  Response buffer preview: ' .. tostring(request.responseBuffer):sub(1, 200))
        end
        
        if request.responseData == nil then
            log('E', 'repoManager', 'Server Error - no response data')
            log('E', 'repoManager', 'url = s1/v4/getMods')
            log('E', 'repoManager', 'responseBuffer = ' .. tostring(request.responseBuffer or 'nil'))
            
            guihooks.trigger('ModListReceived', { 
                data = {}, 
                count = 0, 
                error = 'Server returned no data',
                responseCode = request.responseCode,
                responseBuffer = request.responseBuffer
            })
            return
        end
        
        log('I', 'repoManager', 'Successfully received mod list data')
        
        local modList = request.responseData.data or {}
        log('D', 'repoManager', 'Received ' .. #modList .. ' mods')
        
        -- Process the mod list (similar to base game repository)
        for k, v in pairs(modList) do
            -- Add additional fields that the base game adds
            modList[k].pending = false -- We don't track pending downloads in our UI
            modList[k].unpacked = false -- Repository mods are always packed
            modList[k].downState = false -- No download state for repository browsing
        end
        
        -- Add metadata that base game includes
        request.responseData.metered = not Engine.Platform.isNetworkUnrestricted()
        request.responseData.updatingRepo = false -- We're not updating, just browsing
        
        log('I', 'repoManager', 'Triggering ModListReceived with processed data')
        guihooks.trigger('ModListReceived', request.responseData)
        
    end, {
        query = query or '',
        order_by = orderBy or 'downloads',
        order = order or 'desc',
        page = (page or 1) - 1, -- API uses 0-based pages
        categories = categories or {}
    })
end

-- Delete a custom pack
local function deleteCustomPack(packName)
    local packDir = "/dependencies/" .. packName
    
    if not FS:directoryExists(packDir) then
        log('E', 'repoManager', 'Pack directory not found: ' .. packDir)
        guihooks.trigger('CustomPackDeleted', { success = false, error = 'Pack not found' })
        return false
    end
    
    -- Remove the entire pack directory
    if not FS:directoryRemove(packDir) then
        log('E', 'repoManager', 'Failed to delete pack directory: ' .. packDir)
        guihooks.trigger('CustomPackDeleted', { success = false, error = 'Failed to delete pack directory' })
        return false
    end
    
    log('I', 'repoManager', 'Successfully deleted custom pack: ' .. packName)
    guihooks.trigger('CustomPackDeleted', { success = true, packName = packName })
    return true
end

M.sendPackStatuses = sendPackStatuses
M.sendSubscriptionStatus = sendSubscriptionStatus
M.sendPackStatusesDelayed = function(delay)
    print("Sending pack statuses delayed by " .. delay .. " seconds")
    core_jobsystem.create( function(job)
        job.sleep(delay)
        sendPackStatuses()
    end)
end

M.loadDependencies = loadDependencies
M.requestModWithDelay = requestModWithDelay
M.requestMultipleMods = requestMultipleMods
M.checkAllPackStatuses = checkAllPackStatuses
M.clearModCache = clearModCache
M.getCacheInfo = getCacheInfo
M.getModToPacks = getModToPacks
M.findModContainingFile = findModContainingFile
M.getFileOwnerMod = getFileOwnerMod
M.isFileInAnyMod = isFileInAnyMod
M.getBaseMod = getBaseMod
M.getAllAvailableMods = function()
    local mods = getAllAvailableMods()
    guihooks.trigger('AllModsLoaded', mods)
end
M.createCustomPack = createCustomPack
M.loadPackForEdit = loadPackForEdit
M.updateCustomPack = updateCustomPack
M.deleteCustomPack = deleteCustomPack
M.requestRepositoryMods = requestRepositoryMods

return M