-- This Source Code Form is subject to the terms of the bCDDL, v. 1.1.
-- If a copy of the bCDDL was not distributed with this
-- file, You can obtain one at http://beamng.com/bCDDL-1.1.txt

local M = {}

local tag = 'ramp_latch'

local function onInit()
    electrics.values.doorR = 0
end

local function updateGFX(dt)
    if electrics.values.doorR == 0 then
        beamstate.attachCouplers(tag)
    elseif electrics.values.doorR == 1 then
        beamstate.detachCouplers(tag)
    end
end

local function onCouplerAttached(nodeId, obj2id, obj2nodeId)
end

local function onCouplerDetached(nodeId, obj2id, obj2nodeId)
end

-- public interface
M.onCouplerAttached = onCouplerAttached
M.onCouplerDetached = onCouplerDetached

M.onInit      = onInit
M.onReset     = onInit
M.updateGFX = updateGFX

return M
