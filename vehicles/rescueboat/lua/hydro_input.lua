-- This Source Code Form is subject to the terms of the bCDDL, v. 1.1.
-- If a copy of the bCDDL was not distributed with this
-- file, You can obtain one at http://beamng.com/bCDDL-1.1.txt

local M = {}

local function onReset()
    
	
	
	
	electrics.values['tilt_engine'] = 0
    electrics.values['tilt_engine_input'] = 0
	
	
    
	
	
	
	
end

local function updateGFX(dt)
   
	
	electrics.values['tilt_engine'] = math.min(1, math.max(0, (electrics.values['tilt_engine'] + electrics.values['tilt_engine_input'] * dt * 0.3)))
	
	
end

-- public interface
M.onInit    = onReset
M.onReset   = onReset
M.updateGFX = updateGFX

return M
