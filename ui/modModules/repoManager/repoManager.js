'use strict'

angular.module('beamng.stuff')
.controller('RepoManagerController', ['$scope', '$state', function($scope, $state) {
  // === CORE STATE ===
  $scope.dependencies = [];
  $scope.loading = true;
  $scope.enabledPacks = {};
  $scope.packStatuses = {};
  
  // Pack queue and current pack (from Lua)
  $scope.packQueue = [];
  $scope.currentPack = null;
  $scope.packModCount = 0;
  $scope.packModDone = 0;
  
  // Download states
  $scope.currentDownloadStates = [];
  
  // Current download pack data (stored in scope to prevent recalculation)
  $scope.currentDownloadPack = null;
  
  // Modal state
  $scope.selectedPack = null;
  $scope.packModDetails = [];
  $scope.loadingPackDetails = false;
  $scope.showDetailsModal = false;
  $scope.currentPage = 1;
  $scope.modsPerPage = 9;
  $scope.totalPages = 1;
  $scope.requestedMods = [];
  $scope.loadedModsCount = 0;
  
  // Custom pack creation state
  $scope.showCreatePackModal = false;
  $scope.createPackForm = {
    name: '',
    description: '',
    selectedMods: {}
  };
  $scope.allAvailableMods = [];
  $scope.loadingAllMods = false;
  $scope.createPackCurrentPage = 1;
  $scope.createPackModsPerPage = 12;
  $scope.createPackTotalPages = 1;
  $scope.createPackFilter = '';
  $scope.filteredMods = [];
  $scope.editingPack = null; // Track if we're editing an existing pack
  
  // Delete confirmation modal
  $scope.showDeleteConfirmModal = false;
  $scope.packToDelete = null;
  
  // Mod association data
  $scope.packToMod = {};
  $scope.baseMod = null;
  $scope.modToPacks = {};
  $scope.modSections = [];
  $scope.expandedSections = {};
  
  $scope._intervals = [];
  $scope._timeouts = [];

  // === UTILITY FUNCTIONS ===
  $scope.loadEnabledState = function() {
    const saved = localStorage.getItem('repoManager_enabledPacks');
    if (saved) {
      $scope.enabledPacks = JSON.parse(saved);
    }
  };
  
  $scope.saveEnabledState = function() {
    localStorage.setItem('repoManager_enabledPacks', JSON.stringify($scope.enabledPacks));
  };
  
  $scope.formatModFileSize = function(bytes) {
    if (!bytes || bytes === 0) return '0 KB';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };
  
  $scope.formatDownloadSpeed = function(bytesPerSecond) {
    if (!bytesPerSecond || bytesPerSecond === 0) return '';
    return $scope.formatModFileSize(bytesPerSecond) + '/s';
  };

  $scope.getShortModId = function(modId) {
    if (!modId) return '';
    return modId.length > 8 ? modId.substring(0, 8) + '...' : modId;
  };

  $scope.getModDisplayName = function(modData) {
    if (!modData) return 'Unknown Mod';
    if (modData.filename) {
      let displayName = modData.filename.replace(/\.(zip|rar|7z)$/i, '');
      displayName = displayName.replace(/_/g, ' ');
      return displayName;
    }
    return $scope.getShortModId(modData.modId);
  };

  // === MOD SECTION FUNCTIONS ===
  $scope.buildModSections = function() {
    const sections = {};
    
    // Process existing dependencies
    if ($scope.dependencies && $scope.dependencies.length > 0) {
      $scope.dependencies.forEach(function(pack) {
        const sourceMod = $scope.packToMod[pack.packName];
        let modName = sourceMod;
        
        // Use "Base" for the base mod
        if (sourceMod === $scope.baseMod) {
          modName = 'Base';
        } else if (!sourceMod) {
          modName = 'Custom';
        }
        
        if (!sections[modName]) {
          sections[modName] = {
            modName: modName,
            sourceMod: sourceMod,
            packs: [],
            isBase: sourceMod === $scope.baseMod,
            isCustom: modName === 'Custom'
          };
        }
        
        sections[modName].packs.push(pack);
      });
    }
    
    // Always ensure Custom section exists with Create Pack option
    if (!sections['Custom']) {
      sections['Custom'] = {
        modName: 'Custom',
        sourceMod: null,
        packs: [],
        isBase: false,
        isCustom: true
      };
    }
    
    // Add the Create Pack pseudo-pack to Custom section
    const createPackCard = {
      id: '__create_pack__',
      packName: '__create_pack__',
      name: 'Create New Pack',
      description: 'Create your own custom dependency pack from your installed mods',
      imagePath: '/ui/modModules/repoManager/icons/create-pack.png',
      count: 0,
      isCreatePack: true,
      order: 999
    };
    
    sections['Custom'].packs.push(createPackCard);
    
    // Convert to array and sort (Custom first, then Base, then alphabetically)
    $scope.modSections = Object.values(sections).sort(function(a, b) {
      if (a.isCustom) return -1;
      if (b.isCustom) return 1;
      if (a.isBase) return -1;
      if (b.isBase) return 1;
      return a.modName.localeCompare(b.modName);
    });
    
    // Initialize expanded state for sections
    $scope.modSections.forEach(function(section) {
      if ($scope.expandedSections[section.modName] === undefined) {
        $scope.expandedSections[section.modName] = section.isBase || section.isCustom; // Base and Custom expanded by default
      }
    });
  };
  
  $scope.toggleSection = function(sectionName) {
    $scope.expandedSections[sectionName] = !$scope.expandedSections[sectionName];
    $scope.saveExpandedState();
  };
  
  $scope.isSectionExpanded = function(sectionName) {
    return $scope.expandedSections[sectionName] || false;
  };
  
  $scope.saveExpandedState = function() {
    localStorage.setItem('repoManager_expandedSections', JSON.stringify($scope.expandedSections));
  };
  
  $scope.loadExpandedState = function() {
    const saved = localStorage.getItem('repoManager_expandedSections');
    if (saved) {
      $scope.expandedSections = JSON.parse(saved);
    }
  };
  
  $scope.queueAllPacksInSection = function(section) {
    if (!section.packs || section.packs.length === 0) return;
    
    // Filter out the Create Pack card
    const realPacks = section.packs.filter(function(pack) {
      return !pack.isCreatePack;
    });
    
    if (realPacks.length === 0) return;
    
    const packNames = realPacks.map(function(pack) {
      return pack.packName;
    });
    
    const luaTable = '{' + packNames.map(name => `'${name}'`).join(',') + '}';
    bngApi.engineLua(`extensions.requiredMods.queuePacks(${luaTable})`);
  };
  
  $scope.deactivateAllPacksInSection = function(section) {
    if (!section.packs || section.packs.length === 0) return;
    
    // Filter out the Create Pack card
    const realPacks = section.packs.filter(function(pack) {
      return !pack.isCreatePack;
    });
    
    if (realPacks.length === 0) return;
    
    // Update local state
    realPacks.forEach(function(pack) {
      $scope.enabledPacks[pack.id] = false;
    });
    $scope.saveEnabledState();
    
    const packNames = realPacks.map(function(pack) {
      return pack.packName;
    });
    
    const luaTable = '{' + packNames.map(name => `'${name}'`).join(',') + '}';
    bngApi.engineLua(`extensions.requiredMods.deactivatePacks(${luaTable})`);
    bngApi.engineLua('extensions.repoManager.sendPackStatuses()');
  };
  
  $scope.getSectionStatus = function(section) {
    if (!section.packs || section.packs.length === 0) return { text: 'EMPTY', class: 'empty' };
    
    // Filter out the Create Pack card from status calculations
    const realPacks = section.packs.filter(pack => !pack.isCreatePack);
    
    if (realPacks.length === 0) return { text: 'EMPTY', class: 'empty' };
    
    const activePacks = realPacks.filter(pack => $scope.enabledPacks[pack.id]);
    const downloadingPacks = realPacks.filter(pack => $scope.isPackDownloading(pack));
    
    if (downloadingPacks.length > 0) {
      return { text: 'DOWNLOADING', class: 'downloading' };
    }
    
    if (activePacks.length === realPacks.length) {
      return { text: 'ALL ENABLED', class: 'enabled' };
    } else if (activePacks.length > 0) {
      return { text: 'PARTIAL', class: 'partial' };
    } else {
      return { text: 'DISABLED', class: 'disabled' };
    }
  };
  
  $scope.canQueueSection = function(section) {
    if (!section.packs) return false;
    const realPacks = section.packs.filter(pack => !pack.isCreatePack);
    return realPacks.some(pack => !$scope.enabledPacks[pack.id] && !$scope.isPackDownloading(pack));
  };
  
  $scope.canDeactivateSection = function(section) {
    if (!section.packs) return false;
    const realPacks = section.packs.filter(pack => !pack.isCreatePack);
    return realPacks.some(pack => $scope.enabledPacks[pack.id]);
  };

  // === SIMPLE PACK STATUS FUNCTIONS ===
  $scope.isPackDownloading = function(pack) {
    return $scope.currentPack === pack.packName;
  };

  $scope.isPackQueued = function(packId) {
    const pack = $scope.dependencies.find(p => p.id === packId);
    return pack && $scope.packQueue.includes(pack.packName);
  };

  $scope.isAnyPackDownloading = function() {
    return $scope.currentPack !== null;
  };

  $scope.hasPacksToInstall = function() {
    return $scope.dependencies.some(function(pack) {
      return !$scope.enabledPacks[pack.id] && !$scope.isPackDownloading(pack);
    });
  };

  // === SIMPLIFIED PROGRESS FUNCTIONS ===
  $scope.getCurrentProgressCount = function() {
    return $scope.packModDone || 0;
  };

  $scope.getCurrentlyDownloadingPack = function() {
    return $scope.currentDownloadPack;
  };
  
  $scope.updateCurrentDownloadPack = function() {
    if (!$scope.currentPack) {
      $scope.currentDownloadPack = null;
      return;
    }
    
    const pack = $scope.dependencies.find(p => p.packName === $scope.currentPack);
    if (!pack) {
      $scope.currentDownloadPack = null;
      return;
    }
    
    const downloadingMods = $scope.getDownloadingMods(pack);
    
    $scope.currentDownloadPack = {
      pack: pack,
      progress: {
        packName: pack.packName,
        activeMods: $scope.packModDone,
        totalMods: $scope.packModCount,
        pendingMods: Math.max(0, $scope.packModCount - $scope.packModDone),
        downloadingMods: downloadingMods
      }
    };
  };

  $scope.getDownloadingMods = function(pack) {
    if (!$scope.currentDownloadStates || !Array.isArray($scope.currentDownloadStates) || !pack || !pack.modIds) {
      return [];
    }
    
    // Get only working download states to improve performance
    const workingStates = $scope.currentDownloadStates.filter(function(state) {
      return state && state.state === 'working';
    });
    
    if (workingStates.length === 0) {
      return [];
    }
    
    const downloadingMods = [];
    const addedModIds = new Set(); // Prevent duplicates
    
    // First, try exact ID matches (most reliable)
    workingStates.forEach(function(state) {
      if (state.id && pack.modIds.includes(state.id) && !addedModIds.has(state.id)) {
        downloadingMods.push($scope.createModProgressData(state, state.id));
        addedModIds.add(state.id);
      }
    });
    
    // Then try broader matches for any remaining unmatched mods
    if (downloadingMods.length < workingStates.length) {
      workingStates.forEach(function(state) {
        // Skip if we already matched this state by ID
        if (state.id && addedModIds.has(state.id)) return;
        
        let matchingModId = null;
        
        // Try filename matching
        if (state.filename) {
          matchingModId = pack.modIds.find(function(modId) {
            const matches = !addedModIds.has(modId) && state.filename.includes(modId);
            return matches;
          });
        }
        
        // Try URI matching if filename didn't work
        if (!matchingModId && state.uri) {
          matchingModId = pack.modIds.find(function(modId) {
            const matches = !addedModIds.has(modId) && state.uri.includes(modId);
            return matches;
          });
        }
        
        // If still no match, try any string field that might contain mod ID
        if (!matchingModId) {
          matchingModId = pack.modIds.find(function(modId) {
            if (addedModIds.has(modId)) return false;
            
            // Check all string properties of the state
            for (const key in state) {
              if (typeof state[key] === 'string' && state[key].includes(modId)) {
                return true;
              }
            }
            return false;
          });
        }
        
        if (matchingModId) {
          downloadingMods.push($scope.createModProgressData(state, matchingModId));
          addedModIds.add(matchingModId);
        }
      });
    }

    return downloadingMods;
  };
  
  $scope.createModProgressData = function(downloadState, modId) {
    return {
      modId: modId,
      filename: downloadState.filename || modId,
      progress: downloadState.dltotal > 0 ? Math.floor((downloadState.dlnow / downloadState.dltotal) * 100) : 0,
      dlnow: downloadState.dlnow || 0,
      dltotal: downloadState.dltotal || 0,
      downloadSpeed: downloadState.speed || 0
    };
  };

  $scope.shouldShowPreparingDownloads = function() {
    if (!$scope.currentPack) return false;
    if (!$scope.currentDownloadStates || !Array.isArray($scope.currentDownloadStates)) return true;
    const hasActiveDownloads = $scope.currentDownloadStates.some(state => state && state.state === 'working');
    return !hasActiveDownloads;
  };

  // === SIMPLIFIED BUTTON STATE FUNCTIONS ===
  $scope.getPackButtonState = function(pack) {
    if (pack.isCreatePack) {
      return { text: 'Create Pack', disabled: false, class: 'create-pack-btn' };
    }
    
    if ($scope.isPackDownloading(pack)) {
      return { text: 'Downloading...', disabled: true, class: 'downloading-btn' };
    }
    
    if ($scope.isPackQueued(pack.id)) {
      const position = $scope.packQueue.indexOf(pack.packName) + 1;
      return { text: 'Remove from Queue (' + position + ')', disabled: false, class: 'queue-btn' };
    }
    
    if ($scope.enabledPacks[pack.id]) {
      return { text: 'Disable Pack', disabled: false, class: 'disable-btn' };
    }
    
    if ($scope.isAnyPackDownloading()) {
      return { text: 'Queue Pack', disabled: false, class: 'enable-btn' };
    }
    
    return { text: 'Enable Pack', disabled: false, class: 'enable-btn' };
  };

  $scope.getPackStatusState = function(pack) {
    if (pack.isCreatePack) {
      return { text: 'CREATE', class: 'create-pack' };
    }
    
    if ($scope.isPackDownloading(pack)) {
      return { text: 'DOWNLOADING', class: 'downloading' };
    }
    
    if ($scope.enabledPacks[pack.id]) {
      return { text: 'ENABLED', class: 'enabled' };
    }
    
    return { text: 'DISABLED', class: 'disabled' };
  };

  // === PACK ACTIONS ===
  $scope.togglePack = function(pack) {
    // Handle Create Pack card
    if (pack.isCreatePack) {
      $scope.showCreatePackModal = true;
      $scope.loadAllAvailableMods();
      return;
    }
    
    if ($scope.isPackDownloading(pack)) return;
    
    if ($scope.isPackQueued(pack.id)) {
      $scope.removeFromQueue(pack.id);
      return;
    }
    
    if ($scope.enabledPacks[pack.id]) {
      $scope.enabledPacks[pack.id] = false;
      $scope.saveEnabledState();
      bngApi.engineLua(`extensions.requiredMods.deactivatePack('${pack.packName}')`);
      bngApi.engineLua('extensions.repoManager.sendPackStatuses()');
    } else {
      bngApi.engineLua(`extensions.requiredMods.subscribeToPack('${pack.packName}')`);
    }
  };

  $scope.queuePack = function(pack) {
    bngApi.engineLua(`extensions.requiredMods.subscribeToPack('${pack.packName}')`);
  };

  $scope.removeFromQueue = function(packId) {
    const pack = $scope.dependencies.find(p => p.id === packId);
    if (pack) {
      bngApi.engineLua(`extensions.requiredMods.removePackFromQueue('${pack.packName}')`);
    }
  };

  $scope.installAllPacks = function() {
    bngApi.engineLua('extensions.requiredMods.queueAllPacks()');
  };
  
  $scope.uninstallAllPacks = function() {
    $scope.dependencies.forEach(function(pack) {
      $scope.enabledPacks[pack.id] = false;
    });
    $scope.saveEnabledState();
    
    bngApi.engineLua('extensions.requiredMods.clearPackQueue()');
    bngApi.engineLua('extensions.requiredMods.disableAllMods()');
    bngApi.engineLua('extensions.repoManager.sendPackStatuses()');
  };

  // === LUA COMMUNICATION ===
  $scope.loadDependencies = function() {
    bngApi.engineLua('extensions.repoManager.loadDependencies()');
  };
  
  $scope.requestQueueUpdate = function() {
    bngApi.engineLua('extensions.requiredMods.sendPackProgress()');
  };

  // === EVENT HANDLERS ===
  $scope.$on('downloadStatesChanged', function(event, progressData) {
    $scope.$apply(function() {
      $scope.currentDownloadStates = Array.isArray(progressData) ? progressData : [];
      $scope.updateCurrentDownloadPack();
      if ($scope.loading) $scope.loading = false;
    });
  });
  
  $scope.$on('ModDownloaded', function(event, data) {
    $scope.$apply(function() {
      if ($scope.loading) $scope.loading = false;
    });
  });
  
  $scope.$on('UpdateFinished', function(event) {
    $scope.$apply(function() {
      // Update finished
    });
  });
  
  $scope.$on('DependenciesLoaded', function(event, data) {
    $scope.$apply(function() {
      if (!data || Object.keys(data).length === 0) {
        $scope.dependencies = [];
        $scope.loading = false;
        return;
      }
      
      $scope.dependencies = Object.keys(data).map(function(dirPath) {
        const packData = data[dirPath];
        const dirName = dirPath.replace('/dependencies/', '');
        
              const pack = {
        id: dirName,
        packName: packData.packName,
        dirPath: dirPath,
        name: packData.info.name || dirName,
        description: packData.info.description || 'No description available',
        preview: packData.info.preview || 'image.png',
        imagePath: packData.info.previewPath || (dirPath + '/image.png'),
        modIds: packData.requiredMods.modIds || [],
        count: packData.requiredMods.modIds ? packData.requiredMods.modIds.length : 0,
        order: packData.info.order || 999
      };
        
        if ($scope.enabledPacks[pack.id] === undefined) {
          $scope.enabledPacks[pack.id] = true;
        }
        
              return pack;
    });
    
    // Sort dependencies by order field
    $scope.dependencies.sort(function(a, b) {
      return a.order - b.order;
    });
    
    $scope.loading = false;
      $scope.saveEnabledState();
      
      $scope.updateCurrentDownloadPack();
      
      // Build mod sections if we have mod association data
      if ($scope.packToMod && Object.keys($scope.packToMod).length > 0) {
        $scope.buildModSections();
      }
      
      setTimeout(function() {
        $scope.requestQueueUpdate();
      }, 100);
    });
  });
  
  $scope.$on('PackStatusesLoaded', function(event, data) {
    $scope.$apply(function() {
      $scope.packStatuses = data;
      if ($scope.loading) $scope.loading = false;
      
      Object.keys(data).forEach(function(packName) {
        const status = data[packName];
        const pack = $scope.dependencies.find(p => p.packName === packName);
        if (pack) {
          $scope.enabledPacks[pack.id] = status.isPackFullyActive;
        }
      });
      
      $scope.saveEnabledState();
      $scope.requestQueueUpdate();
    });
  });
  
  $scope.$on('ModAssociationLoaded', function(event, data) {
    $scope.$apply(function() {
      if (data) {
        $scope.packToMod = data.packToMod || {};
        $scope.baseMod = data.baseMod;
        $scope.modToPacks = data.modToPacks || {};
        
        // Build mod sections if we have dependencies loaded
        if ($scope.dependencies && $scope.dependencies.length > 0) {
          $scope.buildModSections();
        }
      }
    });
  });
  
  $scope.$on('packQueueUpdate', function(event, queueData) {
    $scope.$apply(function() {
      if (queueData && queueData.packQueue !== undefined && (Array.isArray(queueData.packQueue) || typeof queueData.packQueue === 'object')) {
        // Convert Lua table (object) to array if needed
        $scope.packQueue = Array.isArray(queueData.packQueue) ? queueData.packQueue : Object.values(queueData.packQueue);
        $scope.currentPack = queueData.currentPack || null;
        $scope.packModCount = queueData.packModCount || 0;
        $scope.packModDone = queueData.packModDone || 0;
      } else {
        $scope.packQueue = [];
        $scope.currentPack = null;
        $scope.packModCount = 0;
        $scope.packModDone = 0;
      }
      $scope.updateCurrentDownloadPack();
    });
  });
  
  $scope.$on('onNextPackDownload', function(event, packName) {
    $scope.$apply(function() {
      $scope.requestQueueUpdate();
    });
  });
  
  $scope.$on('AllModsLoaded', function(event, data) {
    $scope.$apply(function() {
      $scope.allAvailableMods = data || [];
      $scope.loadingAllMods = false;
      $scope.filterMods();
    });
  });
  
  $scope.$on('CustomPackCreated', function(event, data) {
    $scope.$apply(function() {
      if (data.success) {
        $scope.cancelCreatePack();
        $scope.loadDependencies(); // Reload to show the new pack
        alert($scope.editingPack ? 'Pack updated successfully!' : 'Pack created successfully!');
      } else {
        alert('Failed to ' + ($scope.editingPack ? 'update' : 'create') + ' pack: ' + (data.error || 'Unknown error'));
      }
    });
  });
  
  $scope.$on('PackLoadedForEdit', function(event, data) {
    $scope.$apply(function() {
      console.log('PackLoadedForEdit event received:', data);
      
      if (data.success) {
        // Populate form with existing pack data
        $scope.createPackForm.name = data.pack.name;
        $scope.createPackForm.description = data.pack.description;
        
        console.log('Setting form data - name:', data.pack.name, 'description:', data.pack.description);
        console.log('Pack mod data:', data.pack);
        
        // Pre-select mods that are in this pack
        $scope.createPackForm.selectedMods = {};
        
        // Wait for mods to load, then select the appropriate ones
        if ($scope.allAvailableMods.length === 0) {
          console.log('Mods not loaded yet, setting up watcher');
          // Mods are still loading, wait for them
          const unwatch = $scope.$watch('allAvailableMods', function(newVal) {
            console.log('Mods loaded via watcher, length:', newVal ? newVal.length : 0);
            if (newVal && newVal.length > 0) {
              $scope.preselectPackMods(data.pack);
              unwatch(); // Stop watching
            }
          });
        } else {
          console.log('Mods already loaded, directly preselecting. Available mods:', $scope.allAvailableMods.length);
          // Mods are already loaded
          $scope.preselectPackMods(data.pack);
        }
      } else {
        alert('Failed to load pack data: ' + (data.error || 'Unknown error'));
        $scope.cancelCreatePack();
      }
    });
  });
  
  $scope.$on('CustomPackDeleted', function(event, data) {
    $scope.$apply(function() {
      if (data.success) {
        $scope.loadDependencies(); // Reload to remove the deleted pack
        alert('Pack deleted successfully!');
      } else {
        alert('Failed to delete pack: ' + (data.error || 'Unknown error'));
      }
    });
  });
  
  $scope.preselectPackMods = function(pack) {
    // Clear existing selections first
    $scope.createPackForm.selectedMods = {};
    
    // Select mods that were in the original pack
    // Ensure we always have arrays, even if Lua sends objects
    const modIdsToSelect = Array.isArray(pack.modIds) ? pack.modIds : (pack.modIds ? Object.values(pack.modIds) : []);
    const modNamesToSelect = Array.isArray(pack.modNames) ? pack.modNames : (pack.modNames ? Object.values(pack.modNames) : []);
    
    console.log('Preselecting mods - IDs:', modIdsToSelect, 'Names:', modNamesToSelect);
    console.log('modIds type:', typeof pack.modIds, 'isArray:', Array.isArray(pack.modIds));
    console.log('modNames type:', typeof pack.modNames, 'isArray:', Array.isArray(pack.modNames));
    
    $scope.allAvailableMods.forEach(function(mod) {
      if ((mod.tagid && modIdsToSelect.includes(mod.tagid)) ||
          (mod.modname && modNamesToSelect.includes(mod.modname))) {
        const modId = mod.tagid || mod.modname;
        $scope.createPackForm.selectedMods[modId] = mod;
        console.log('Selected mod:', mod.title || mod.name || mod.modname);
      }
    });
    
    console.log('Total selected mods:', Object.keys($scope.createPackForm.selectedMods).length);
    
    $scope.filterMods(); // Update filtered view
  };

  // === NAVIGATION ===
  $scope.goBack = function() {
    $state.go('menu.mainmenu');
  };
  
  $scope.viewCollection = function(pack) {
    $state.go('menu.mods.repository', {}, { reload: true });
  };

  // === PACK DETAILS MODAL ===
  $scope.showPackDetails = function(pack) {
    $scope.selectedPack = pack;
    $scope.packModDetails = [];
    $scope.loadingPackDetails = true;
    $scope.showDetailsModal = true;
    $scope.currentPage = 1;
    $scope.totalPages = Math.ceil(pack.modIds.length / $scope.modsPerPage);
    $scope.requestedMods = [];
    $scope.loadModsPage(1);
  };
  
  $scope.loadModsPage = function(pageNumber) {
    $scope.loadingPackDetails = true;
    $scope.packModDetails = [];
    $scope.currentPage = pageNumber;
    $scope.loadedModsCount = 0;
    $scope.requestedMods = [];
    
    const startIndex = (pageNumber - 1) * $scope.modsPerPage;
    const endIndex = Math.min(startIndex + $scope.modsPerPage, $scope.selectedPack.modIds.length);
    const modsToLoad = $scope.selectedPack.modIds.slice(startIndex, endIndex);
    
    $scope.requestedMods = [...modsToLoad];
    const luaTable = '{' + modsToLoad.map(modId => `'${modId}'`).join(',') + '}';
    bngApi.engineLua(`extensions.repoManager.requestMultipleMods(${luaTable})`);
    
    const modalTimeout = setTimeout(function() {
      $scope.$apply(function() {
        if ($scope.loadingPackDetails && $scope.requestedMods.length > 0) {
          $scope.loadingPackDetails = false;
        }
      });
    }, 20000);
    $scope._timeouts.push(modalTimeout);
  };
  
  $scope.goToPage = function(pageNumber) {
    if (pageNumber >= 1 && pageNumber <= $scope.totalPages) {
      $scope.loadModsPage(pageNumber);
    }
  };
  
  $scope.previousPage = function() {
    if ($scope.currentPage > 1) {
      $scope.goToPage($scope.currentPage - 1);
    }
  };
  
  $scope.nextPage = function() {
    if ($scope.currentPage < $scope.totalPages) {
      $scope.goToPage($scope.currentPage + 1);
    }
  };
  
  $scope.closePackDetails = function() {
    $scope.showDetailsModal = false;
    $scope.selectedPack = null;
    $scope.packModDetails = [];
  };
  
  $scope.formatFileSize = function(bytes) {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };
  
  $scope.openModInRepo = function(mod) {
    bngApi.engineLua(`guihooks.trigger('ChangeState', {state = 'menu.mods.details', params = {modId = '${mod.tagid}'}})`);
  };
  
  $scope.subscribeToMod = function(mod) {
    bngApi.engineLua(`extensions.core_repository.modSubscribe('${mod.tagid}')`);
    mod.sub = true;
    mod.subscribed = true;
    mod.pending = true;
  };
  
  $scope.unsubscribeFromMod = function(mod) {
    bngApi.engineLua(`extensions.core_repository.modUnsubscribe('${mod.tagid}')`);
    mod.sub = false;
    mod.subscribed = false;
  };
  
  $scope.getCacheInfo = function() {
    bngApi.engineLua('extensions.repoManager.getCacheInfo()');
  };
  
  $scope.clearCache = function() {
    bngApi.engineLua('extensions.repoManager.clearModCache()');
  };

  // === CUSTOM PACK CREATION FUNCTIONS ===
  $scope.loadAllAvailableMods = function() {
    $scope.loadingAllMods = true;
    $scope.allAvailableMods = [];
    bngApi.engineLua('extensions.repoManager.getAllAvailableMods()');
  };
  
  $scope.filterMods = function() {
    if (!$scope.createPackFilter) {
      $scope.filteredMods = $scope.allAvailableMods;
    } else {
      const filter = $scope.createPackFilter.toLowerCase();
      $scope.filteredMods = $scope.allAvailableMods.filter(function(mod) {
        return (mod.title && mod.title.toLowerCase().includes(filter)) ||
               (mod.name && mod.name.toLowerCase().includes(filter)) ||
               (mod.modname && mod.modname.toLowerCase().includes(filter)) ||
               (mod.author && mod.author.toLowerCase().includes(filter)) ||
               (mod.tagid && mod.tagid.toLowerCase().includes(filter));
      });
    }
    $scope.createPackTotalPages = Math.ceil($scope.filteredMods.length / $scope.createPackModsPerPage);
    $scope.createPackCurrentPage = 1;
  };
  
  $scope.getPagedMods = function() {
    if (!$scope.filteredMods || $scope.filteredMods.length === 0) {
      return [];
    }
    const startIndex = ($scope.createPackCurrentPage - 1) * $scope.createPackModsPerPage;
    const endIndex = Math.min(startIndex + $scope.createPackModsPerPage, $scope.filteredMods.length);
    return $scope.filteredMods.slice(startIndex, endIndex);
  };
  
  $scope.toggleModSelection = function(mod) {
    const modId = mod.tagid || mod.modname;
    if ($scope.createPackForm.selectedMods[modId]) {
      delete $scope.createPackForm.selectedMods[modId];
    } else {
      $scope.createPackForm.selectedMods[modId] = mod;
    }
  };
  
  $scope.isModSelected = function(mod) {
    const modId = mod.tagid || mod.modname;
    return !!$scope.createPackForm.selectedMods[modId];
  };
  
  $scope.getSelectedModCount = function() {
    return Object.keys($scope.createPackForm.selectedMods).length;
  };
  
  $scope.createPack = function() {
    if ($scope.editingPack) {
      $scope.updatePack();
      return;
    }
    
    if (!$scope.createPackForm.name || !$scope.createPackForm.name.trim()) {
      alert('Please enter a pack name');
      return;
    }
    
    if ($scope.getSelectedModCount() === 0) {
      alert('Please select at least one mod for the pack');
      return;
    }
    
    const selectedMods = Object.values($scope.createPackForm.selectedMods);
    const modIds = [];
    const modNames = [];
    
    selectedMods.forEach(function(mod) {
      if (mod.tagid) {
        modIds.push(mod.tagid);
      } else if (mod.modname) {
        modNames.push(mod.modname);
      }
    });
    
    const packData = {
      name: $scope.createPackForm.name.trim(),
      description: $scope.createPackForm.description.trim() || 'Custom pack created by user',
      modIds: modIds,
      modNames: modNames
    };
    
    const jsonString = JSON.stringify(packData).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    bngApi.engineLua(`extensions.repoManager.createCustomPack("${jsonString}")`);
  };
  
  $scope.cancelCreatePack = function() {
    $scope.showCreatePackModal = false;
    $scope.createPackForm = {
      name: '',
      description: '',
      selectedMods: {}
    };
    $scope.allAvailableMods = [];
    $scope.filteredMods = [];
    $scope.createPackFilter = '';
    $scope.createPackCurrentPage = 1;
    $scope.editingPack = null; // Reset editing state
  };
  
  $scope.goToCreatePackPage = function(pageNumber) {
    if (pageNumber >= 1 && pageNumber <= $scope.createPackTotalPages) {
      $scope.createPackCurrentPage = pageNumber;
    }
  };
  
  $scope.previousCreatePackPage = function() {
    if ($scope.createPackCurrentPage > 1) {
      $scope.goToCreatePackPage($scope.createPackCurrentPage - 1);
    }
  };
  
  $scope.nextCreatePackPage = function() {
    if ($scope.createPackCurrentPage < $scope.createPackTotalPages) {
      $scope.goToCreatePackPage($scope.createPackCurrentPage + 1);
    }
  };
  
  // === CUSTOM PACK MANAGEMENT ===
  $scope.isCustomPack = function(pack) {
    // Custom packs are those without a source mod
    const section = $scope.modSections.find(s => s.isCustom);
    return section && section.packs.includes(pack) && !pack.isCreatePack;
  };
  
  $scope.editCustomPack = function(pack) {
    if (!$scope.isCustomPack(pack)) return;
    
    console.log('Editing pack:', pack);
    
    $scope.editingPack = pack;
    $scope.showCreatePackModal = true;
    $scope.loadAllAvailableMods();
    
    // Load existing pack data
    console.log('Loading pack for edit:', pack.packName);
    bngApi.engineLua(`extensions.repoManager.loadPackForEdit('${pack.packName}')`);
  };
  
  $scope.deleteCustomPack = function(pack) {
    if (!$scope.isCustomPack(pack)) {
      return;
    }
    
    $scope.packToDelete = pack;
    $scope.showDeleteConfirmModal = true;
  };
  
  $scope.confirmDelete = function() {
    if (!$scope.packToDelete) return;
    
    bngApi.engineLua(`extensions.repoManager.deleteCustomPack('${$scope.packToDelete.packName}')`);
    $scope.cancelDelete();
  };
  
  $scope.cancelDelete = function() {
    $scope.showDeleteConfirmModal = false;
    $scope.packToDelete = null;
  };
  
  $scope.updatePack = function() {
    if (!$scope.editingPack) return;
    
    if (!$scope.createPackForm.name || !$scope.createPackForm.name.trim()) {
      alert('Please enter a pack name');
      return;
    }
    
    if ($scope.getSelectedModCount() === 0) {
      alert('Please select at least one mod for the pack');
      return;
    }
    
    const selectedMods = Object.values($scope.createPackForm.selectedMods);
    const modIds = [];
    const modNames = [];
    
    selectedMods.forEach(function(mod) {
      if (mod.tagid) {
        modIds.push(mod.tagid);
      } else if (mod.modname) {
        modNames.push(mod.modname);
      }
    });
    
    const packData = {
      originalName: $scope.editingPack.packName,
      name: $scope.createPackForm.name.trim(),
      description: $scope.createPackForm.description.trim() || 'Custom pack created by user',
      modIds: modIds,
      modNames: modNames
    };
    
    const jsonString = JSON.stringify(packData).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    bngApi.engineLua(`extensions.repoManager.updateCustomPack("${jsonString}")`);
  };

  $scope.$on('ModReceived', function(event, data) {
    $scope.$apply(function() {
      if (data && data.data && $scope.requestedMods.includes(data.data.tagid)) {
        const modData = data.data;
        
        if (modData.isLocal && modData.localIconPath) {
          modData.icon = modData.localIconPath;
        } else if (modData.path) {
          modData.icon = `https://api.beamng.com/s1/v4/download/mods/${modData.path}icon.jpg`;
        } else {
          modData.icon = null;
        }
        
        modData.downTxt = modData.download_count > 1000 ? 
          (modData.download_count / 1000).toFixed(0) + "K" : 
          modData.download_count;
        modData.rating_avg = parseFloat(modData.rating_avg || 0).toFixed(1);
        modData.filesize_display = $scope.formatFileSize(modData.filesize);
        
        if (!modData.author && modData.creator) {
          modData.author = modData.creator;
        } else if (!modData.author && modData.username) {
          modData.author = modData.username;
        } else if (!modData.author && modData.user_name) {
          modData.author = modData.user_name;
        }
        
        $scope.packModDetails.push(modData);
        
        const index = $scope.requestedMods.indexOf(data.data.tagid);
        if (index > -1) {
          $scope.requestedMods.splice(index, 1);
        }
        
        $scope.loadedModsCount++;
        
        if ($scope.requestedMods.length === 0) {
          $scope.loadingPackDetails = false;
        }
      }
    });
  });

  // === INITIALIZATION ===
  $scope.loadEnabledState();
  $scope.loadExpandedState();
  $scope.loadDependencies();
  
  // Safety timeout
  const safetyTimeout = setTimeout(function() {
    if ($scope.loading) {
      $scope.$apply(function() {
        $scope.loading = false;
        if (!$scope.dependencies || $scope.dependencies.length === 0) {
          $scope.dependencies = [];
        }
      });
    }
  }, 3000);
  $scope._timeouts.push(safetyTimeout);
  
  // Loading check interval
  const mainInterval = setInterval(function() {
    if ($scope.loading && ($scope.dependencies && $scope.dependencies.length > 0)) {
      $scope.$apply(function() {
        $scope.loading = false;
      });
    }
  }, 2000);
  $scope._intervals.push(mainInterval);
  
  // Cleanup
  $scope.$on('$destroy', function() {
    $scope._intervals.forEach(function(interval) {
      clearInterval(interval);
    });
    $scope._intervals = [];
    
    $scope._timeouts.forEach(function(timeout) {
      clearTimeout(timeout);
    });
    $scope._timeouts = [];
  });

}])

.filter('range', function() {
  return function(input, start, end) {
    var range = [];
    for (var i = start; i <= end; i++) {
      range.push(i);
    }
    return range;
  };
})

export default angular.module('repoManager', ['ui.router'])

.config(['$stateProvider', function($stateProvider) {
  $stateProvider.state('menu.repoManager', {
    url: '/repoManager',
    templateUrl: '/ui/modModules/repoManager/repoManager.html',
    controller: 'RepoManagerController',
  })
}])

.run(['$rootScope', function ($rootScope) {
  function addRepoManagerButton() {
    if (window.bridge && window.bridge.events) {
      try {
        window.bridge.events.on("MainMenuButtons", function(addButton) {
          if (typeof addButton === 'function') {
            const buttonConfig = {
              icon: '/ui/modModules/repoManager/icons/repoManagerIcon.png',
              targetState: 'menu.repoManager',
              translateid: 'Repo Manager'
            };
            addButton(buttonConfig)
          }
        })
      } catch (e) {
        console.error('RepoManager: Error registering bridge event listener:', e)
      }
    }
  }

  addRepoManagerButton()
}])