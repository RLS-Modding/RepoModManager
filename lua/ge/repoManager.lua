local M = {}

local packData = {}
local modRequestQueue = {}
local isProcessingQueue = false
local REQUEST_DELAY = 0.1
local modDataCache = {} -- Cache for storing mod data
local CACHE_EXPIRY_TIME = 300 -- 5 minutes in seconds

local function isModCached(modId)
    if not modDataCache[modId] then
        return false
    end
    
    local currentTime = os.time()
    local cacheAge = currentTime - modDataCache[modId].cacheTime
    
    if cacheAge > CACHE_EXPIRY_TIME then
        -- Cache expired, remove it
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
    
    -- Check cache first
    local cachedData = getCachedMod(modId)
    if cachedData then
        guihooks.trigger('ModReceived', cachedData)
        
        -- Continue processing queue
        if #modRequestQueue > 0 then
            isProcessingQueue = false
            processModRequestQueue()
        else
            isProcessingQueue = false
        end
        return
    end
    
    -- Always try local data first
    local modname = core_modmanager.getModNameFromID(modId)
    if modname then
        local mdb = core_modmanager.getModDB(modname)
        if mdb and mdb.modData then
            local data = {}
            data.data = mdb.modData
            data.localMod = mdb
            data.ok = 1
            
            -- Only set local icon path if the icon file actually exists
            local iconPath = "mod_info/"..modId.."/icon.jpg"
            if FS:fileExists(iconPath) then
                data.data.isLocal = true
                local fileUrl = "file://" .. iconPath:gsub("\\", "/")
                
                -- Try relative path first (often works better in BeamNG)
                data.data.localIconPath = iconPath
                data.data.localIconPathAlt = fileUrl
                
                log('D', 'repoManager', 'Using relative path: ' .. data.data.localIconPath)
            else
                log('D', 'repoManager', 'No local icon for: ' .. modId)
            end
            
            -- Check if mod is currently active/subscribed
            if mdb.active then
                data.data.sub = true
                data.data.subscribed = true
                log('D', 'repoManager', 'Mod ' .. modId .. ' is currently active')
            else
                data.data.sub = false
                data.data.subscribed = false
                log('D', 'repoManager', 'Mod ' .. modId .. ' is inactive')
            end
            
            -- Set other required fields for proper UI display
            data.data.pending = false
            data.data.unpacked = not mdb.fullpath:find("%.zip$")
            data.data.downState = false
            data.data.updatingRepo = false
            data.data.metered = not Engine.Platform.isNetworkUnrestricted()
            
            -- Cache the local data
            cacheModData(modId, data)
            
            guihooks.trigger('ModReceived', data)
            
            -- Continue processing queue
            if #modRequestQueue > 0 then
                isProcessingQueue = false
                processModRequestQueue()
            else
                isProcessingQueue = false
            end
            return
        end
    end
    
    -- Use the same logic as repository.lua but with our own handling
    if settings.getValue('onlineFeatures') ~= 'enable' then
        -- Try offline first
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
        
        -- Schedule next request
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
    
    -- Make online API call
    core_online.apiCall('s1/v4/getMod/'..modId, function(request)
        if request.responseData == nil then
            log('W', 'repoManager', 'Server Error for mod: ' .. modId)
        else
            -- Process successful response
            request.responseData.data.message = string.gsub(request.responseData.data.message or "", "\n", "<br>")
            request.responseData.data.pending = false
            request.responseData.data.unpacked = core_modmanager.modIsUnpacked(request.responseData.data.filename or "")
            request.responseData.data.downState = false
            request.responseData.updatingRepo = false
            request.responseData.metered = not Engine.Platform.isNetworkUnrestricted()
            
            -- Cache the online data
            cacheModData(modId, request.responseData)
            
            guihooks.trigger('ModReceived', request.responseData)
        end
        
        -- Schedule next request with delay
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
    
    -- Start processing if not already running
    if not isProcessingQueue then
        processModRequestQueue()
    end
end

local function requestMultipleMods(modIds)
    log('D', 'repoManager', 'Queueing ' .. #modIds .. ' mod requests')
    
    -- Clear any existing queue
    modRequestQueue = {}
    
    -- Add all mods to queue
    for _, modId in ipairs(modIds) do
        table.insert(modRequestQueue, modId)
    end
    
    -- Start processing
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
            
            -- Use higher precision for large packs, similar to frontend
            local percentage
            if totalCount > 50 then
                -- Use 1 decimal place for large packs
                local rawPercentage = totalCount > 0 and (activeCount / totalCount) * 100 or 0
                percentage = math.min(math.floor(rawPercentage * 10 + 0.5) / 10, 100)
            else
                -- Use integer precision for smaller packs
                percentage = totalCount > 0 and math.floor((activeCount / totalCount) * 100) or 0
            end
            local isPackActive = activeCount > 0 -- Pack has SOME active mods
            local isPackFullyActive = activeCount == totalCount -- Pack has ALL mods active
            
            packStatuses[pData.packName] = {
                packName = pData.packName,
                directory = directory,
                activeCount = activeCount,
                totalCount = totalCount,
                percentage = percentage,
                isPackActive = isPackActive,
                isPackFullyActive = isPackFullyActive, -- New field for 100% completion
                activeMods = activeMods,
                inactiveMods = inactiveMods
            }
            
            log('D', 'repoManager', 'Pack: ' .. pData.packName .. ' - ' .. activeCount .. '/' .. totalCount .. ' active (' .. percentage .. '%)')
        end
    end
    
    return packStatuses
end

local function loadDependencies()
    packData = {} -- Clear previous data
    local directories = FS:findFiles('/dependencies/', "*", 0, false, true)
    for _, directory in ipairs(directories) do
        
        local requiredModsFile = io.open(directory .. "/requiredMods.json", "r")
        if requiredModsFile then
            local requiredModsData = jsonDecode(requiredModsFile:read("*all"))
            requiredModsFile:close()
            local infoFile = io.open(directory .. "/info.json", "r")
            if infoFile then
                local infoData = jsonDecode(infoFile:read("*all"))
                -- Fix preview path to be relative to the pack directory
                if infoData.preview then
                    infoData.previewPath = directory .. "/" .. infoData.preview
                end
                -- Extract just the folder name from the full path
                local folderName = directory:match("([^/]+)$")
                packData[directory] = {
                    packName = folderName,
                    requiredMods = requiredModsData,
                    info = infoData
                }
                infoFile:close()
            end
        end
    end
    
    -- Check initial pack statuses after loading dependencies
    local packStatuses = checkAllPackStatuses()
    
    guihooks.trigger('DependenciesLoaded', packData)
    guihooks.trigger('PackStatusesLoaded', packStatuses)
end

local function getAllModsStatus()
    local modsStatus = {}
    
    -- Go through all packs and check mod status
    for directory, pData in pairs(packData) do
        if pData.requiredMods and pData.requiredMods.modIds then
            for _, modId in ipairs(pData.requiredMods.modIds) do
                if not modsStatus[modId] then
                    local modName = core_modmanager.getModNameFromID(modId)
                    local isActive = false
                    
                    if modName then
                        local modData = core_modmanager.getModDB(modName)
                        if modData and modData.active then
                            isActive = true
                        end
                    end
                    
                    modsStatus[modId] = {
                        modId = modId,
                        modName = modName,
                        active = isActive
                    }
                end
            end
        end
    end
    
    return modsStatus
end

local function getPackStatus(packName)
    -- Find the pack data
    local pack = nil
    for _, pData in pairs(packData) do
        if pData.packName == packName then
            pack = pData
            break
        end
    end
    
    if not pack or not pack.requiredMods or not pack.requiredMods.modIds then
        return {active = 0, total = 0, percentage = 0}
    end
    
    local activeCount = 0
    local totalCount = #pack.requiredMods.modIds
    
    for _, modId in ipairs(pack.requiredMods.modIds) do
        local modName = core_modmanager.getModNameFromID(modId)
        if modName then
            local modData = core_modmanager.getModDB(modName)
            if modData and modData.active then
                activeCount = activeCount + 1
            end
        end
    end
    
    -- Use higher precision for large packs, similar to frontend
    local percentage
    if totalCount > 50 then
        -- Use 1 decimal place for large packs
        local rawPercentage = totalCount > 0 and (activeCount / totalCount) * 100 or 0
        percentage = math.min(math.floor(rawPercentage * 10 + 0.5) / 10, 100)
    else
        -- Use integer precision for smaller packs
        percentage = totalCount > 0 and math.floor((activeCount / totalCount) * 100) or 0
    end
    
    return {
        active = activeCount,
        total = totalCount,
        percentage = percentage
    }
end

local function getPackProgressUpdate(packName)
    -- Find the pack data
    local pack = nil
    for _, pData in pairs(packData) do
        if pData.packName == packName then
            pack = pData
            break
        end
    end
    
    if not pack or not pack.requiredMods or not pack.requiredMods.modIds then
        return {packName = packName, active = 0, total = 0, percentage = 0, activeMods = {}}
    end
    
    local activeCount = 0
    local totalCount = #pack.requiredMods.modIds
    local activeMods = {}
    
    for _, modId in ipairs(pack.requiredMods.modIds) do
        local modName = core_modmanager.getModNameFromID(modId)
        local isActive = false
        
        if modName then
            local modData = core_modmanager.getModDB(modName)
            if modData and modData.active then
                isActive = true
                activeCount = activeCount + 1
                table.insert(activeMods, modId)
            end
        end
    end
    
    -- Use higher precision for large packs, similar to frontend
    local percentage
    if totalCount > 50 then
        -- Use 1 decimal place for large packs
        local rawPercentage = totalCount > 0 and (activeCount / totalCount) * 100 or 0
        percentage = math.min(math.floor(rawPercentage * 10 + 0.5) / 10, 100)
    else
        -- Use integer precision for smaller packs
        percentage = totalCount > 0 and math.floor((activeCount / totalCount) * 100) or 0
    end
    
    return {
        packName = packName,
        active = activeCount,
        total = totalCount,
        percentage = percentage,
        activeMods = activeMods
    }
end

M.onModActivated = function(modData)
    -- When any mod is activated OR deactivated, send updated status for all packs
    log('D', 'repoManager', 'Mod state changed, refreshing pack statuses')
    for directory, pData in pairs(packData) do
        if pData.packName then
            local progress = getPackProgressUpdate(pData.packName)
            guihooks.trigger('PackProgressUpdate', progress)
        end
    end
    
    -- Also send updated pack statuses
    local packStatuses = checkAllPackStatuses()
    guihooks.trigger('PackStatusesLoaded', packStatuses)
end

local function refreshPackStatuses()
    local packStatuses = checkAllPackStatuses()
    guihooks.trigger('PackStatusesLoaded', packStatuses)
    return packStatuses
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

-- Trigger progress update for a specific pack (used for immediate updates)
local function triggerPackProgressUpdate(packName)
    local progress = getPackProgressUpdate(packName)
    guihooks.trigger('PackProgressUpdate', progress)
    log('D', 'repoManager', 'Triggered progress update for pack: ' .. packName .. 
        ' - Active: ' .. progress.active .. '/' .. progress.total .. ' (' .. progress.percentage .. '%)')
end

M.onModDownloadCompleted = function(downloadData)
    -- Handle individual mod download completion/failure for pack progress updates
    local status = downloadData.downloadComplete and 'completed' or 'failed'
    local errorMsg = downloadData.error and (' - ' .. downloadData.error) or ''
    log('D', 'repoManager', 'Mod download ' .. status .. ': ' .. (downloadData.modID or 'unknown') .. errorMsg)
    
    -- Find packs that contain this mod and trigger immediate progress updates
    for directory, pData in pairs(packData) do
        if pData.packName and pData.requiredMods and pData.requiredMods.modIds then
            for _, modId in ipairs(pData.requiredMods.modIds) do
                if modId == downloadData.modID then
                    -- Use helper function for consistent progress updates
                    -- This will recalculate progress based on current active mods
                    triggerPackProgressUpdate(pData.packName)
                    break
                end
            end
        end
    end
end

M.loadDependencies = loadDependencies
M.getPackStatus = getPackStatus
M.getAllModsStatus = getAllModsStatus
M.getPackProgressUpdate = getPackProgressUpdate
M.triggerPackProgressUpdate = triggerPackProgressUpdate
M.onModActivated = M.onModActivated
M.onModDownloadCompleted = M.onModDownloadCompleted
M.requestModWithDelay = requestModWithDelay
M.requestMultipleMods = requestMultipleMods
M.checkAllPackStatuses = checkAllPackStatuses
M.refreshPackStatuses = refreshPackStatuses
M.clearModCache = clearModCache
M.getCacheInfo = getCacheInfo

return M