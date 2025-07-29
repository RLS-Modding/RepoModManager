local M = {}

local ourParentMod = nil
local ourDependencyIds = {}
local subscriptionQueue = {}
local activeSubscriptions = {}
local completedSubscriptions = {}
local maxConcurrentSubscriptions = 3
local isSubscribing = false
local progressQueue = {}
local progressQueueDirty = false
local updateQueue = {}
local updatingRepo = false
local retryQueue = {}
local retryTimers = {}
local baseRetryDelay = 10.0
local maxRetryDelay = 300.0
local maxRetryAttempts = 5

local packsQueued = {}
local packQueue = {}
local currentPack = nil

local packModCount = 0
local packModDownloaded = 0
local packModActivated = 0

local startNextSubscription

local function downloadProgressCallback(r)
    for k, v in pairs(progressQueue) do
        if v.id == r.id then
            progressQueue[k] = r
            progressQueueDirty = true
            return
        end
    end
    table.insert(progressQueue, r)
    progressQueueDirty = true
end

local function uiUpdateQueue()
    local data = {}
    data.updatingList = {}
    data.doneList = {}
    data.missingList = {}
    
    for k, v in ipairs(updateQueue) do
        if v.state == "done" then
            table.insert(data.doneList, v)
        elseif v.action == "missing" then
            table.insert(data.missingList, v)
        else
            table.insert(data.updatingList, v)
        end
    end
    
    data.updating = updatingRepo
    guihooks.trigger('UpdateQueueState', data)
end

local function addToUpdateQueue(modData)
    for k, v in pairs(updateQueue) do
        if v.id == modData.id then
            return
        end
    end
    
    local queueData = {
        id = modData.id,
        dirname = "/mods/repo/",
        dlnow = 0,
        speed = 0,
        fileext = "zip",
        outfile = "/mods/repo/" .. modData.filename,
        state = "updating",
        time = 0,
        uri = modData.id .. "/" .. modData.ver .. "/" .. modData.filename,
        icon = modData.id .. "/" .. modData.ver .. "/" .. "icon.jpg",
        modname = modData.filename:gsub(".zip", ""),
        filename = modData.filename,
        ver = modData.ver,
        reason = "subscription",
        update = true,
        conflict = nil
    }
    
    table.insert(updateQueue, queueData)
    uiUpdateQueue()
end

local function changeStateUpdateQueue(filename, newState)
    for k, v in pairs(updateQueue) do
        if v.filename == filename then
            updateQueue[k].state = newState
            uiUpdateQueue()
            guihooks.trigger('RepoModChangeStatus', v)
            return
        end
    end
end

local function findRequiredModsFiles(basePath, foundFiles)
    foundFiles = foundFiles or {}
    
    local reqModsPath = basePath .. "/requiredMods.json"
    if FS:fileExists(reqModsPath) then
        table.insert(foundFiles, reqModsPath)
    end

    local items = FS:findFiles(basePath, "*", 0, false, true)
    
    for _, item in ipairs(items) do
        local dirName = item:match("([^/]+)$")
        local fullItemPath = basePath .. "/" .. dirName
        
        if FS:directoryExists(fullItemPath) then
            findRequiredModsFiles(fullItemPath, foundFiles)
        end
    end
    
    return foundFiles
end

local function parseRequiredModsFile(filePath)
    local file = io.open(filePath, "r")
    if not file then
        log("E", "Required Mods", "Could not open file: " .. filePath)
        return {}
    end
    
    local content = file:read("*all")
    file:close()
    
    if not content or content == "" then
        return {}
    end
    
    local success, data = pcall(jsonDecode, content)
    if not success then
        log("E", "Required Mods", "Failed to parse JSON in " .. filePath .. ": " .. tostring(data))
        return {}
    end
    
    if not data or (not data.modIds or type(data.modIds) ~= "table") and (not data.modNames or type(data.modNames) ~= "table") then
        log("W", "Required Mods", "Invalid format in " .. filePath)
        return {}
    end

    return {modIds = data.modIds, modNames = data.modNames}
end

local function collectAllRequiredMods()
    local allModIds = {}
    local allModNames = {}
    local modIdSet = {}
    local modNameSet = {}
    local basePath = "/dependencies"

    if FS:directoryExists(basePath) then
        local requiredModsFiles = findRequiredModsFiles(basePath)
        
        for _, filePath in ipairs(requiredModsFiles) do
            local mods = parseRequiredModsFile(filePath)
            
            if mods.modIds then
                for _, modId in ipairs(mods.modIds) do
                    if type(modId) == "string" and modId ~= "" and not modIdSet[modId] then
                        table.insert(allModIds, modId)
                        modIdSet[modId] = true
                        ourDependencyIds[modId] = true
                    end
                end
            end

            if mods.modNames then
                for _, modName in ipairs(mods.modNames) do
                    if type(modName) == "string" and modName ~= "" and not modNameSet[modName] then
                        table.insert(allModNames, modName)
                        modNameSet[modName] = true
                    end
                end
            end
        end
    end
    
    return {modIds = allModIds, modNames = allModNames}
end

local function isModAlreadyActive(modId, modName)
    if not core_modmanager then
        return false
    end
    
    if not modName then
        modName = core_modmanager.getModNameFromID(modId)
    end
    
    if not modName then
        return false
    end
    
    local modData = core_modmanager.getModDB(modName)
    if not modData then
        return false
    end
    
    return modData.active == true
end

local function saveModStateToPersistence(modIdentifiers, newActiveState)
    local persistencyfile = 'mods/db.json'
    
    local persistenceData = jsonReadFile(persistencyfile)
    if not persistenceData or not persistenceData.mods then
        log("W", "Required Mods", "Could not read mod persistence file")
        return
    end
    
    local updatedCount = 0
    
    for _, identifier in ipairs(modIdentifiers) do
        local modName = identifier
        
        if not persistenceData.mods[identifier] then
            modName = core_modmanager.getModNameFromID(identifier)
        end
        
        if modName and persistenceData.mods[modName] then
            persistenceData.mods[modName].active = newActiveState
            updatedCount = updatedCount + 1
        end
    end

    if updatedCount > 0 then
        jsonWriteFile(persistencyfile, persistenceData, true)
    end
end

local function batchActivateMods(modNames)
    if not modNames or #modNames == 0 then
        return
    end
    
    local allMods = core_modmanager.getMods()
    local mountList = {}
    local allMountedFilesChange = {}
    local allModScripts = {}
    local activatedMods = {}
    
    for _, modName in ipairs(modNames) do
        if allMods[modName] then
            local modData = allMods[modName]
            if not modData.active then
                if not FS:isMounted(modData.fullpath) then
                    local mountEntry = {
                        srcPath = modData.fullpath,
                        mountPath = modData.mountPoint or ""
                    }
                    table.insert(mountList, mountEntry)
                end
                
                if modData.modData and modData.modData.hashes then
                    for _, hashData in ipairs(modData.modData.hashes) do
                        table.insert(allMountedFilesChange, {
                            filename = "/" .. hashData[1]:gsub("\\", ""),
                            type = "added"
                        })
                    end
                end
                
                if modData.modData and modData.modData.hashes then
                    for _, hashData in ipairs(modData.modData.hashes) do
                        local filePath = "/" .. hashData[1]:gsub("\\", "")
                        if (filePath:find("/scripts/") or filePath:find("/mods_data/")) and filePath:find("/modScript.lua") then
                            table.insert(allModScripts, filePath)
                        end
                    end
                end
                
                table.insert(activatedMods, modData)
            end
        end
    end
    
    if #mountList > 0 then
        if not FS:mountList(mountList) then
            log("E", "Required Mods", "Failed to mount mods in batch")
            return
        end
    end
    
    for _, scriptPath in ipairs(allModScripts) do
        local status, ret = pcall(dofile, scriptPath)
        if not status then
            log("E", "Required Mods", "Failed to execute mod script: " .. scriptPath)
        end
    end
    
    for _, modData in ipairs(activatedMods) do
        modData.active = true
    end
    
    if #activatedMods > 0 then
        local mergedHashes = {}
        local mergedModNames = {}
        local mergedModIDs = {}
        local mergedFilePaths = {}
        
        for _, modData in ipairs(activatedMods) do
            table.insert(mergedModNames, modData.modname or "unknown")
            
            if modData.modID then
                table.insert(mergedModIDs, modData.modID)
            end
            
            if modData.fullpath then
                table.insert(mergedFilePaths, modData.fullpath)
            end
            
            if modData.modData and modData.modData.hashes then
                for _, hashData in ipairs(modData.modData.hashes) do
                    table.insert(mergedHashes, hashData)
                end
            end
        end
        
        local combinedModData = {
            modname = "BatchActivation_" .. table.concat(mergedModNames, "_"),
            modID = table.concat(mergedModIDs, "_"),
            fullpath = mergedFilePaths,
            active = true,
            batch = true,
            count = #activatedMods,
            originalMods = activatedMods,
            modData = {
                hashes = mergedHashes,
                tagid = table.concat(mergedModIDs, "_"),
                batch_activation = true
            }
        }
        
        extensions.hook('onModActivated', deepcopy(combinedModData))
    end
    
    if #allMountedFilesChange > 0 then
        _G.onFileChanged(allMountedFilesChange)
    end
    
    loadManualUnloadExtensions()
    
    saveModStateToPersistence(modNames, true)
end

local function batchDeactivateMods(modIdentifiers)
    if not modIdentifiers or #modIdentifiers == 0 then
        return
    end
    
    local allMods = core_modmanager.getMods()
    local allMountedFilesChange = {}
    local deactivatedMods = {}
    
    for _, identifier in ipairs(modIdentifiers) do
        local modName = identifier
        
        if not allMods[identifier] then
            modName = core_modmanager.getModNameFromID(identifier)
        end
        
        if modName and allMods[modName] then
            local modData = allMods[modName]
            if modData.active then
                if modData.modData and modData.modData.hashes then
                    for _, hashData in ipairs(modData.modData.hashes) do
                        table.insert(allMountedFilesChange, {
                            filename = "/" .. hashData[1]:gsub("\\", ""),
                            type = "deleted"
                        })
                    end
                end
                
                table.insert(deactivatedMods, {name = modName, data = modData})
            end
        end
    end
    
    for _, mod in ipairs(deactivatedMods) do
        if FS:isMounted(mod.data.fullpath) then
            if not FS:unmount(mod.data.fullpath) then
                log("E", "Required Mods", "Failed to unmount mod: " .. mod.name)
            end
        end
    end
    
    for _, mod in ipairs(deactivatedMods) do
        mod.data.active = false
    end
    
    if #deactivatedMods > 0 then
        local mergedHashes = {}
        local mergedModNames = {}
        local mergedModIDs = {}
        local mergedFilePaths = {}
        local originalMods = {}
        
        for _, mod in ipairs(deactivatedMods) do
            table.insert(mergedModNames, mod.data.modname or "unknown")
            table.insert(originalMods, mod.data)
            
            if mod.data.modID then
                table.insert(mergedModIDs, mod.data.modID)
            end
            
            if mod.data.fullpath then
                table.insert(mergedFilePaths, mod.data.fullpath)
            end
            
            if mod.data.modData and mod.data.modData.hashes then
                for _, hashData in ipairs(mod.data.modData.hashes) do
                    table.insert(mergedHashes, hashData)
                end
            end
        end
        
        local combinedModData = {
            modname = "BatchDeactivation_" .. table.concat(mergedModNames, "_"),
            modID = table.concat(mergedModIDs, "_"),
            fullpath = mergedFilePaths,
            active = false,
            batch = true,
            count = #deactivatedMods,
            originalMods = originalMods,
            modData = {
                hashes = mergedHashes,
                tagid = table.concat(mergedModIDs, "_"),
                batch_deactivation = true
            }
        }
        
        extensions.hook('onModDeactivated', deepcopy(combinedModData))
    end
    
    if #allMountedFilesChange > 0 then
        _G.onFileChanged(allMountedFilesChange)
    end
    
    saveModStateToPersistence(modIdentifiers, false)
end

local function activateDownloadedMods(successfulSubs)
    local modsToActivate = {}
    
    for _, sub in ipairs(successfulSubs) do
        local modName = core_modmanager.getModNameFromID(sub.id)
        if modName then
            table.insert(modsToActivate, modName)
        end
    end
    
    if #modsToActivate > 0 then
        batchActivateMods(modsToActivate)
    end
end

local startModDownload

local function mountLocallyAvailableMods(modIds)
    if not modIds or #modIds == 0 then
        return {}
    end
    
    local modsToActivate = {}
    local foundMods = {}
    
    for _, modId in ipairs(modIds) do
        if not isModAlreadyActive(modId) then
            local modName = core_modmanager.getModNameFromID(modId)
            if modName then
                table.insert(modsToActivate, modName)
                table.insert(foundMods, modId)
                log("I", "Required Mods", "Found locally available mod: " .. modId)
            end
        end
    end
    
    if #modsToActivate > 0 then
        log("I", "Required Mods", "Mounting " .. #modsToActivate .. " locally available mods due to server unavailability")
        batchActivateMods(modsToActivate)
        
        guihooks.trigger("toastrMsg", {
            type = "info", 
            title = "Server Unavailable", 
            msg = "Mounted " .. #modsToActivate .. " locally available mods. Will retry server connection."
        })
    end
    
    return foundMods
end

local function scheduleRetry(modId, attempt)
    attempt = attempt or 1
    
    if attempt > maxRetryAttempts then
        log("E", "Required Mods", "Max retry attempts reached for mod: " .. modId)
        
        table.insert(completedSubscriptions, {
            id = modId,
            success = false,
            error = "Max retry attempts reached - server unavailable"
        })
        
        guihooks.trigger("toastrMsg", {
            type = "error", 
            title = "Server Unavailable", 
            msg = "Failed to connect to server after " .. maxRetryAttempts .. " attempts for mod: " .. modId
        })
        
        startNextSubscription()
        return
    end
    
    local delay = math.min(baseRetryDelay * math.pow(2, attempt - 1), maxRetryDelay)
    
    log("I", "Required Mods", "Scheduling retry #" .. attempt .. " for mod " .. modId .. " in " .. delay .. " seconds")
    
    retryTimers[modId] = {
        timeLeft = delay,
        attempt = attempt,
        modId = modId
    }
    
    guihooks.trigger("toastrMsg", {
        type = "warning", 
        title = "Server Retry", 
        msg = "Retrying connection for " .. modId .. " in " .. math.floor(delay) .. " seconds (attempt " .. attempt .. "/" .. maxRetryAttempts .. ")"
    })
end

local function subscribeToMod(modId, retryAttempt)
    retryAttempt = retryAttempt or 1
    
    core_online.apiCall('s2/v4/modSubscribe/' .. modId, function(request)
        if request.responseData == nil then
            log("W", "Required Mods", "Server not responding for mod: " .. modId .. " (attempt " .. retryAttempt .. ")")
            
            for i, sub in ipairs(activeSubscriptions) do
                if sub.id == modId then
                    table.remove(activeSubscriptions, i)
                    break
                end
            end
            
            local mountedMods = mountLocallyAvailableMods({modId})
            
            if #mountedMods > 0 then
                table.insert(completedSubscriptions, {
                    id = modId,
                    success = true,
                    localMount = true,
                    error = nil
                })
                startNextSubscription()
            else
                scheduleRetry(modId, retryAttempt)
            end
            
            return
        end
        
        if request.responseData.error ~= nil and request.responseData.error == 1 then
            local msg = request.responseData.message or "no error message"
            log("E", "Required Mods", "Server Error: " .. msg .. " (" .. modId .. ")")
            
            table.insert(completedSubscriptions, {
                id = modId,
                success = false,
                error = msg
            })
            
            guihooks.trigger('repoError', 'Server Error : ' .. msg .. " (" .. modId .. ")")
            
            startNextSubscription()
            return
        end
        
        if retryTimers[modId] then
            retryTimers[modId] = nil
        end
        
        local modData = request.responseData.modData
        modData.id = modId
        modData.reason = "subscription"
        modData.sub = true
        
        table.insert(completedSubscriptions, {
            id = modId,
            success = true,
            modData = modData
        })
        
        guihooks.trigger('ModSubscribed', request.responseData)
        guihooks.trigger('RepoModChangeStatus', modData)
        
        startModDownload(modData)
    end)
end

local function retrySubscription(modId, attempt)
    log("I", "Required Mods", "Retrying subscription for mod: " .. modId .. " (attempt " .. attempt .. ")")
    
    table.insert(activeSubscriptions, {
        id = modId,
        startTime = os.time(),
        isRetry = true,
        attempt = attempt
    })
    
    subscribeToMod(modId, attempt)
end

local onAllSubscriptionsComplete

function startModDownload(modData)
    local targetFilename = '/mods/repo/' .. modData.filename
    local uri = 's1/v4/download/mods/' .. modData.id .. "/" .. modData.ver .. "/" .. modData.filename
    
    addToUpdateQueue(modData)
    changeStateUpdateQueue(modData.filename, "downloading")
    
    local function progressCallback(r)
        downloadProgressCallback(r)
        
        for i, sub in ipairs(activeSubscriptions) do
            if sub.id == modData.id then
                sub.progress = r
                break
            end
        end
        
        for k, v in pairs(updateQueue) do
            if v.id == modData.id then
                v.dlspeed = r.dlspeed
                v.dltotal = r.dltotal
                v.dlnow = r.dlnow
                v.time = r.time
                v.effectiveURL = r.effectiveURL
                break
            end
        end
    end
    
    local function completionCallback(r)
        packModDownloaded = packModDownloaded + 1
        downloadProgressCallback(r)
        
        for k, v in pairs(progressQueue) do
            if v.id == r.id then
                table.remove(progressQueue, k)
                progressQueueDirty = true
                break
            end
        end
        
        for i, sub in ipairs(activeSubscriptions) do
            if sub.id == modData.id then
                table.remove(activeSubscriptions, i)
                break
            end
        end
        
        local downloadData = {
            responseData = r.responseData,
            modID = modData.id,
            filename = modData.filename,
            downloadComplete = true
        }
        
        extensions.hook('onModDownloadCompleted', downloadData)
        
        guihooks.trigger('ModDownloaded', downloadData)
        changeStateUpdateQueue(modData.filename, "downloaded")
        
        if r.responseCode ~= 200 then
            log("E", "Required Mods", "Failed to download: " .. modData.id)
            
            local failureData = {
                modID = modData.id,
                filename = modData.filename,
                downloadComplete = false,
                error = "Download failed: " .. tostring(r.responseCode)
            }
            extensions.hook('onModDownloadCompleted', failureData)
            
            guihooks.trigger("toastrMsg", {
                type = "error", 
                title = "Repo Error", 
                msg = "Could not download the file (Check console for details)"
            })
            
            if FS:fileExists(r.outfile) then
                FS:removeFile(r.outfile)
            end
            
            for k, v in pairs(updateQueue) do
                if v.id == modData.id then
                    table.remove(updateQueue, k)
                    break
                end
            end
            
            for i, comp in ipairs(completedSubscriptions) do
                if comp.id == modData.id then
                    comp.downloadSuccess = false
                    comp.error = "Download failed: " .. tostring(r.responseCode)
                    break
                end
            end
        elseif not FS:fileExists(r.outfile) then
            log("E", "Required Mods", "Download file missing: " .. modData.id)
            
            local missingData = {
                modID = modData.id,
                filename = modData.filename,
                downloadComplete = false,
                error = "File missing after download"
            }
            extensions.hook('onModDownloadCompleted', missingData)
            
            guihooks.trigger("toastrMsg", {
                type = "error", 
                title = "Repo Error", 
                msg = "Could not download the file, File missing"
            })
            
            for k, v in pairs(updateQueue) do
                if v.id == modData.id then
                    table.remove(updateQueue, k)
                    break
                end
            end
            
            for i, comp in ipairs(completedSubscriptions) do
                if comp.id == modData.id then
                    comp.downloadSuccess = false
                    comp.error = "File missing after download"
                    break
                end
            end
        else
            local modname = modData.filename:gsub(".zip", ""):lower()
            local prevInfo = core_modmanager.getModDB(modname)
            if prevInfo ~= nil and prevInfo.dirname == "mods/" and prevInfo.fullpath ~= r.outfile then
                core_modmanager.deleteMod(modname)
            end
            
            for i, comp in ipairs(completedSubscriptions) do
                if comp.id == modData.id then
                    comp.downloadSuccess = true
                    comp.filename = r.outfile
                    comp.dlspeed = r.dlspeed
                    comp.dltotal = r.dltotal
                    comp.time = r.time
                    comp.effectiveURL = r.effectiveURL
                    break
                end
            end
            
            changeStateUpdateQueue(modData.filename, "done")
        end
        guihooks.trigger('downloadStateChanged', r)
        
        startNextSubscription()
        M.sendPackProgress()
        
        if #activeSubscriptions == 0 and #subscriptionQueue == 0 then
            if #packQueue > 0 then
                local packName = table.remove(packQueue, 1)
                currentPack = nil
                M.subscribeToPack(packName)
                guihooks.trigger('onNextPackDownload', packName)
                return
            end
            onAllSubscriptionsComplete()
        end
    end
    
    core_online.apiCall(uri, completionCallback, nil, targetFilename, nil, progressCallback)
end

function onAllSubscriptionsComplete()
    isSubscribing = false
    updatingRepo = false
    
    local successfulSubs = {}
    local failedSubs = {}
    
    for _, sub in ipairs(completedSubscriptions) do
        if sub.success and (sub.downloadSuccess or sub.localMount) then
            table.insert(successfulSubs, sub)
        else
            table.insert(failedSubs, sub)
        end
    end
    
    if #successfulSubs > 0 then
        local updmods = {}
        for _, sub in ipairs(successfulSubs) do
            if not sub.localMount then
                table.insert(updmods, {
                    id = sub.id,
                    ver = sub.modData and sub.modData.ver or 0,
                    dlspeed = sub.dlspeed or 0,
                    dltotal = sub.dltotal or 0,
                    time = sub.time or 0,
                    effectiveURL = sub.effectiveURL and sub.effectiveURL:match("https?://([%w.:@]+)") or "unknown"
                })
            end
        end
        
        if #updmods > 0 then
            core_online.apiCall('s2/v4/modUpdateSuccess', function(request)
                if request.responseData == nil then
                    log("W", "Required Mods", "Server not responding to update success report - this is not critical")
                    return
                end
            end, {
                mods = updmods
            })
        end
    end
    
    for i = #updateQueue, 1, -1 do
        if updateQueue[i].state == "done" then
            table.remove(updateQueue, i)
        end
    end
    
    core_modmanager.enableAutoMount()
    
    if #successfulSubs > 0 then
        local modsToActivateLater = successfulSubs
        local activateTimer = 0
        
        local function checkAndActivate(dt)
            activateTimer = activateTimer + dt
            if activateTimer > 1.0 then
                activateDownloadedMods(modsToActivateLater)
                M.pendingActivation = nil
                return
            end
        end
        
        M.pendingActivation = checkAndActivate
    end
    
    currentPack = nil
    packsQueued = {}
    guihooks.trigger('UpdateFinished')
    uiUpdateQueue()
    M.sendPackProgress()
end

function startNextSubscription()
    if #activeSubscriptions >= maxConcurrentSubscriptions or #subscriptionQueue == 0 then
        return
    end
    
    for i = 1, maxConcurrentSubscriptions - #activeSubscriptions do
        if #subscriptionQueue == 0 then
            break
        end
        
        local nextModId = table.remove(subscriptionQueue, 1)
        table.insert(activeSubscriptions, {
            id = nextModId,
            startTime = os.time()
        })
            
        subscribeToMod(nextModId)
    end
end

local function startSubscriptionManager()
    if isSubscribing then
        return
    end
    
    isSubscribing = true
    updatingRepo = true
    completedSubscriptions = {}
    updateQueue = {}
    
    core_modmanager.disableAutoMount()
    
    uiUpdateQueue()
    
    for i = 1, maxConcurrentSubscriptions do
        startNextSubscription()
        if #subscriptionQueue == 0 then
            break
        end
    end
end

local function subscribeToAllRequiredMods()
    local allMods = collectAllRequiredMods()
    local allModIds = allMods.modIds or {}
    local allModNames = allMods.modNames or {}
    
    if #allModIds == 0 and #allModNames == 0 then
        return
    end
    
    local modsToActivate = {}
    local modsToSubscribe = {}
    
    for _, modId in ipairs(allModIds) do
        if isModAlreadyActive(modId) then
            goto continue
        end
        
        local modName = core_modmanager.getModNameFromID(modId)
        if modName then
            table.insert(modsToActivate, modName)
        else
            table.insert(modsToSubscribe, modId)
        end
        
        ::continue::
    end

    for _, modName in ipairs(allModNames) do
        if not isModAlreadyActive(nil, modName) then
            table.insert(modsToActivate, modName)
        end
    end
    
    if #modsToActivate > 0 then
        batchActivateMods(modsToActivate)
    end

    if #modsToSubscribe > 0 then
        subscriptionQueue = modsToSubscribe
        startSubscriptionManager()
    end
end

local function getPackMods(packName)
    local packPath = "/dependencies/" .. packName
    local reqModsPath = packPath .. "/requiredMods.json"
    
    if not FS:directoryExists(packPath) then
        log("W", "Required Mods", "Pack directory not found: " .. packPath)
        return {}
    end
    
    if not FS:fileExists(reqModsPath) then
        log("W", "Required Mods", "requiredMods.json not found in pack: " .. packName)
        return {}
    end
    
    return parseRequiredModsFile(reqModsPath)
end

local function subscribeToPack(packName)
    if currentPack then
        table.insert(packQueue, packName)
        print("Added pack to queue: " .. packName)
        M.sendPackProgress()
        return
    end
    currentPack = packName
    print("Set currentPack to: " .. packName)
    M.sendPackProgress()
    local packMods = getPackMods(packName)

    if #packMods.modIds == 0 and #packMods.modNames == 0 then
        log("W", "Required Mods", "No mods found in pack: " .. packName)
        return
    end
    
    
    local modsToActivate = {}
    local modsToSubscribe = {}
    packModCount = 0
    packModDownloaded = 0
    packModActivated = 0
    
    if not packMods.modIds then
        goto modNames
    end
    for _, modId in ipairs(packMods.modIds) do
        packModCount = packModCount + 1
        ourDependencyIds[modId] = true
        if isModAlreadyActive(modId) then
            packModActivated = packModActivated + 1
            goto continue
        end
        
        local modName = core_modmanager.getModNameFromID(modId)
        if modName then
            table.insert(modsToActivate, modName)
            packModActivated = packModActivated + 1
        else
            table.insert(modsToSubscribe, modId)
        end
        
        ::continue::
    end

    ::modNames::
    if not packMods.modNames then
        goto activate
    end
    for _, modName in ipairs(packMods.modNames) do
        packModCount = packModCount + 1
        if isModAlreadyActive(nil, modName) then
            packModActivated = packModActivated + 1
            goto continue
        end
        
        if modName then
            table.insert(modsToActivate, modName)
            packModActivated = packModActivated + 1
        end
        
        ::continue::
    end

    ::activate::

    log("I", "Required Mods", "Subscribing to pack: " .. packName .. " with " .. packModCount .. " mods")
    
    
    if #modsToActivate > 0 then
        log("I", "Required Mods", "Activating " .. #modsToActivate .. " locally available mods from pack: " .. packName)
        batchActivateMods(modsToActivate)
    end

    if #modsToSubscribe > 0 then
        log("I", "Required Mods", "Downloading " .. #modsToSubscribe .. " mods from pack: " .. packName)
        subscriptionQueue = modsToSubscribe
        if isSubscribing then
            activeSubscriptions = {}
            startNextSubscription()
        else
            startSubscriptionManager()
        end
    else
        if #packQueue > 0 then
            local packName = table.remove(packQueue, 1)
            currentPack = nil
            M.subscribeToPack(packName)
            guihooks.trigger('onNextPackDownload', packName)
            return
        else
            onAllSubscriptionsComplete()
        end
    end
    M.sendPackProgress()
end

function M.queueAllPacks()
    local availablePacks = {}
    local packs = FS:findFiles("/dependencies", "*", -1, true, false)
    for _, pack in ipairs(packs) do
        if string.match(pack, ".*requiredMods.json")  then
            local packName = pack:gsub("/requiredMods.json", "")
            packName = packName:gsub("/dependencies/", "")
            print("Pack: " .. tostring(packName))
            table.insert(availablePacks, packName)
        end
    end
    if #availablePacks > 0 then
        local firstPack = table.remove(availablePacks, 1)
        packQueue = availablePacks
        subscribeToPack(firstPack)
    end
    M.sendPackProgress()
end

local function queuePacks(packNames)
    local queue = packNames
    local firstPack = table.remove(queue, 1)
    packQueue = queue
    subscribeToPack(firstPack)
    M.sendPackProgress()
end

local function deactivatePack(packName)
    local packMods = getPackMods(packName)
    
    if #packMods.modIds == 0 and #packMods.modNames == 0 then
        log("W", "Required Mods", "No mods found in pack: " .. packName)
        return
    end
        
    local activePackMods = {}
    if packMods.modIds then
        for _, modId in ipairs(packMods.modIds) do
            ourDependencyIds[modId] = nil
            if isModAlreadyActive(modId) then
                table.insert(activePackMods, modId)
            end
        end
    end
    if packMods.modNames then
        for _, modName in ipairs(packMods.modNames) do
            ourDependencyIds[modName] = nil
            if isModAlreadyActive(nil, modName) then
                table.insert(activePackMods, modName)
            end
        end
    end

    if #activePackMods > 0 then
        batchDeactivateMods(activePackMods)
    end
end

local function deactivatePacks(packNames)
    local activePackMods = {}
    for _, packName in ipairs(packNames) do
        local packMods = getPackMods(packName)
        if packMods.modIds then
            for _, modId in ipairs(packMods.modIds) do
                if isModAlreadyActive(modId) then
                    table.insert(activePackMods, modId)
                end
            end
        end
        if packMods.modNames then
            for _, modName in ipairs(packMods.modNames) do
                if isModAlreadyActive(nil, modName) then
                    table.insert(activePackMods, modName)
                end
            end
        end
    end

    if #activePackMods > 0 then
        log("I", "Required Mods", "Deactivating " .. #activePackMods .. " active mods from packs: " .. table.concat(packNames, ", "))
        batchDeactivateMods(activePackMods)
    else
        log("I", "Required Mods", "No active mods found in packs: " .. table.concat(packNames, ", "))
    end
end

local updateInterval = 10
local lastUpdateTime = 0

local function onUpdate(dt)
    if progressQueueDirty then
        guihooks.trigger('downloadStatesChanged', progressQueue)
        progressQueueDirty = false
    end
    
    if M.pendingActivation then
        M.pendingActivation(dt)
    end
    
    for modId, retryData in pairs(retryTimers) do
        retryData.timeLeft = retryData.timeLeft - dt
        
        if retryData.timeLeft <= 0 then
            retryTimers[modId] = nil
            retrySubscription(modId, retryData.attempt + 1)
        end
    end
    
    lastUpdateTime = lastUpdateTime + dt
    if lastUpdateTime < updateInterval then
        return
    end
    lastUpdateTime = 0
end

local function onModActivated(modData)
    if not modData or not modData.modname then
        return
    end
    
    if modData.modname and (modData.modname:find("BatchActivation_") or modData.modname:find("BatchDeactivation_")) then
        return
    end
    
    local modId = nil
    if modData.modData and modData.modData.tagid then
        modId = modData.modData.tagid
    end
    
    if ourParentMod then
        return
    end
    
    if modId and not ourDependencyIds[modId] then
        if not ourParentMod then
            ourParentMod = modData.modname
        end
    elseif not modId and not ourParentMod then
        ourParentMod = modData.modname
    end
end

local function disableAllMods()
    local activeDependencies = {}
    local allMods = collectAllRequiredMods()
    for _, modId in ipairs(allMods.modIds) do
        if isModAlreadyActive(modId) then
            table.insert(activeDependencies, modId)
        end
    end
    for _, modName in ipairs(allMods.modNames) do
        if isModAlreadyActive(nil, modName) then
            table.insert(activeDependencies, modName)
        end
    end
    
    if #activeDependencies > 0 then
        batchDeactivateMods(activeDependencies)
    end
end

local function onModDeactivated(modData)
    if not modData or not modData.modname then
        return
    end
    
    if ourParentMod and modData.modname == ourParentMod then
        disableAllMods()
        ourParentMod = nil
    end
end

M.removePackFromQueue = function(packName)
    for i, pack in ipairs(packQueue) do
        if pack == packName then
            table.remove(packQueue, i)
            M.sendPackProgress()
            return
        end
    end
end

M.clearPackQueue = function()
    packQueue = {}
    currentPack = nil
    M.sendPackProgress()
end

M.getPackQueue = function() return packQueue end
M.sendPackProgress = function()
    local progressData = {
        packQueue = packQueue,
        currentPack = currentPack,
        packModCount = packModCount,
        packModDone = packModActivated + packModDownloaded
    }

    guihooks.trigger('packQueueUpdate', progressData)
end

-- Exports
M.onModDeactivated = onModDeactivated
M.onModActivated = onModActivated
M.batchActivateMods = batchActivateMods
M.batchDeactivateMods = batchDeactivateMods
M.getAllRequiredMods = collectAllRequiredMods
M.subscribeToAllMods = subscribeToAllRequiredMods
M.disableAllMods = disableAllMods
M.getParentMod = function() return ourParentMod end
M.onUpdate = onUpdate

M.getSubscriptionStatus = function() 
    return {
        active = #activeSubscriptions,
        queued = #subscriptionQueue,
        completed = #completedSubscriptions,
        isSubscribing = isSubscribing,
        updatingRepo = updatingRepo
    }
end

M.getUpdateQueue = function() return updateQueue end
M.getProgressQueue = function() return progressQueue end
M.isUpdatingRepo = function() return updatingRepo end
M.uiUpdateQueue = uiUpdateQueue

M.getRetryStatus = function() 
    local retryStatus = {}
    for modId, retryData in pairs(retryTimers) do
        retryStatus[modId] = {
            timeLeft = retryData.timeLeft,
            attempt = retryData.attempt,
            nextRetryIn = math.floor(retryData.timeLeft)
        }
    end
    return retryStatus
end

M.cancelRetries = function()
    retryTimers = {}
    log("I", "Required Mods", "All retry timers cancelled")
end

M.mountLocallyAvailableMods = mountLocallyAvailableMods
M.getPackMods = getPackMods
M.subscribeToPack = subscribeToPack
M.deactivatePack = deactivatePack
M.deactivatePacks = deactivatePacks
M.queuePacks = queuePacks

return M