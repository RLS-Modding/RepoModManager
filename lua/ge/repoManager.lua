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
            
            packStatuses[pData.packName] = {
                packName = pData.packName,
                directory = directory,
                activeCount = activeCount,
                totalCount = totalCount,
                isPackActive = isPackActive,
                isPackFullyActive = isPackFullyActive,
                activeMods = activeMods,
                inactiveMods = inactiveMods
            }
            
            log('D', 'repoManager', 'Pack: ' .. pData.packName .. ' - ' .. activeCount .. '/' .. totalCount .. ' active')
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
    
    log('D', 'repoManager', 'SENDING DependenciesLoaded with ' .. #tableKeys(packData or {}) .. ' packs')
    guihooks.trigger('DependenciesLoaded', packData)
    
    log('D', 'repoManager', 'SENDING PackStatusesLoaded with ' .. #tableKeys(packStatuses or {}) .. ' pack statuses')
    guihooks.trigger('PackStatusesLoaded', packStatuses)
end

local function sendPackStatuses()
    local packStatuses = checkAllPackStatuses()
    log('D', 'repoManager', 'SENDING PackStatusesLoaded with ' .. #tableKeys(packStatuses or {}) .. ' pack statuses')
    guihooks.trigger('PackStatusesLoaded', packStatuses)
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

M.sendPackStatuses = sendPackStatuses
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

return M