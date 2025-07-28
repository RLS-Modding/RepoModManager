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
        if pData.requiredMods and pData.requiredMods.modIds then
            local activeCount = 0
            local totalCount = #pData.requiredMods.modIds
            local activeMods = {}
            local inactiveMods = {}
            
            for _, modId in ipairs(pData.requiredMods.modIds) do
                local modName = core_modmanager.getModNameFromID(modId)
                local isActive = false
                
                if modName then
                    local modData = core_modmanager.getModDB(modName)
                    if modData and modData.active then
                        isActive = true
                        activeCount = activeCount + 1
                        table.insert(activeMods, modId)
                    else
                        table.insert(inactiveMods, modId)
                    end
                else
                    table.insert(inactiveMods, modId)
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

M.loadDependencies = loadDependencies
M.requestModWithDelay = requestModWithDelay
M.requestMultipleMods = requestMultipleMods
M.checkAllPackStatuses = checkAllPackStatuses
M.clearModCache = clearModCache
M.getCacheInfo = getCacheInfo

return M