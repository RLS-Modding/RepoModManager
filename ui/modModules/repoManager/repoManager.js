'use strict'

angular.module('beamng.stuff')

.filter('trusted', ['$sce', function($sce) {
  return function(html) {
    if (!html) return '';
    return $sce.trustAsHtml(html);
  };
}])

.controller('RepoManagerController', ['$scope', '$state', '$sanitize', function($scope, $state, $sanitize) {
  // Core State
  $scope.dependencies = [];
  $scope.loading = true;
  $scope.enabledPacks = {};
  $scope.packStatuses = {};
  
  // Pack queue state
  $scope.packQueue = [];
  $scope.currentPack = null;
  $scope.packModCount = 0;
  $scope.packModDone = 0;
  
  // Download states
  $scope.currentDownloadStates = [];
  
  // Rate limiting state
  $scope.isRateLimited = false;
  
  // Current download pack
  $scope.currentDownloadPack = null;
  
  // Modal state
  $scope.selectedPack = null;
  $scope.packModDetails = [];
  $scope.loadingPackDetails = false;
  $scope.showDetailsModal = false;
  $scope.currentPage = 1;
  $scope.modsPerPage = 12;
  $scope.totalPages = 1;
  $scope.requestedMods = [];
  $scope.loadedModsCount = 0;
  
  // Custom pack creation state
  $scope.showCreatePackModal = false;
  $scope.createPackForm = {
    name: '',
    description: '',
    order: 999,
    selectedMods: {}
  };
  $scope.allAvailableMods = [];
  $scope.loadingAllMods = false;
  $scope.createPackCurrentPage = 1;
  $scope.createPackModsPerPage = 10;
  $scope.createPackTotalPages = 1;
  $scope.createPackFilter = '';
  $scope.filteredMods = [];
  $scope.editingPack = null; // Track if we're editing an existing pack
  
  // Repository browsing state
  $scope.createPackActiveTab = 'local'; // 'local', 'repo', or 'selected'
  $scope.repoMods = [];
  $scope.loadingRepoMods = false;
  $scope.repoCurrentPage = 1;
  $scope.repoTotalPages = 1;
  $scope.repoModsPerPage = 12;
  
  // Selected mods tab state
  $scope.selectedModsFilter = '';
  $scope.filteredSelectedMods = [];
  $scope.selectedModsPerPage = 10;
  $scope.selectedModsCurrentPage = 1;
  $scope.selectedModsTotalPages = 1;
  
  // Pack exclusion state for local mods
  $scope.showPackExclusionFilter = false;
  $scope.excludedPacks = [];
  $scope.availablePacksForExclusion = [];
  
  // Mod type filter state for local mods
  $scope.modTypeFilters = {
    local: true,      // Local mods without tagid
    unpacked: true,   // Unpacked mods 
    repo: true        // Repository mods with tagid
  };
  $scope.repoFilter = {
    query: '',
    orderBy: 'update',
    order: 'desc',
    categories: [3, 4, 5, 6, 7, 8, 9, 10, 12, 13, 15], // All categories by default
    subscribedOnly: false
  };
  $scope.repoCategories = [
    { category: 'vehicles', name: 'Land Vehicles', value: 3, originalTxt: "Land" },
    { category: 'vehicles', name: 'Air Vehicles', value: 4, originalTxt: "Air" },
    { category: 'vehicles', name: 'Props', value: 5, originalTxt: "Props" },
    { category: 'vehicles', name: 'Boats', value: 6, originalTxt: "Boats" },
    { category: 'vehicles', name: 'Configurations', value: 14, originalTxt: "Configurations" },
    { category: 'none', name: 'Scenarios', value: 8, originalTxt: "Scenarios" },
    { category: 'none', name: 'Terrains/Maps', value: 9, originalTxt: "Terrains, Levels, Maps" },
    { category: 'none', name: 'User Interface', value: 10, originalTxt: "User Interface Apps" },
    { category: 'none', name: 'Sounds', value: 13, originalTxt: "Sounds" },
    { category: 'none', name: 'License Plates', value: 15, originalTxt: "License Plates" },
    { category: 'none', name: 'Mods of Mods', value: 7, originalTxt: "Mods of Mods" },
    { category: 'none', name: 'Skins', value: 12, originalTxt: "Skins" }
  ];
  $scope.showCategoryFilter = false;
  
  // Custom dropdown states
  $scope.showSortByDropdown = false;
  $scope.showOrderDropdown = false;
  $scope.showLocalModsPerPageDropdown = false;
  $scope.showSelectedModsPerPageDropdown = false;
  
  // Mod info modal states
  $scope.showModInfoModal = false;
  $scope.loadingModInfo = false;
  $scope.selectedModInfo = null;
  
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

  // Utility Functions
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

  // Mod Section Functions
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
        } else {
          // Try to find the actual mod data to get a better display name
          if ($scope.allAvailableMods && $scope.allAvailableMods.length > 0) {
            const modData = $scope.allAvailableMods.find(function(mod) {
              return mod.modname === sourceMod;
            });
            if (modData) {
              // Prioritize title from mod data, then fallback to name, then sourceMod
              if (modData.title && modData.title.trim() !== '') {
                modName = modData.title;
              } else if (modData.name && modData.name.trim() !== '') {
                modName = modData.name;
              } else {
                modName = sourceMod;
              }
            }
          }
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
    
    // Refresh available packs for exclusion after building sections
    $scope.initializeAvailablePacksForExclusion();
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
    const pendingPacks = realPacks.filter(pack => 
      $scope.packStatuses[pack.packName] && $scope.packStatuses[pack.packName].isPending
    );
    
    if (downloadingPacks.length > 0) {
      return { text: 'DOWNLOADING', class: 'downloading' };
    }
    
    if (pendingPacks.length > 0) {
      return { text: 'PENDING', class: 'pending' };
    }
    
    if (activePacks.length === realPacks.length) {
      return { text: 'ALL ENABLED', class: 'enabled' };
    } else if (activePacks.length > 0) {
      return { text: 'PARTIAL', class: 'partial' };
    } else {
      return { text: 'DISABLED', class: 'disabled' };
    }
  };
  
  // Helper function to get author information for a section
  $scope.getSectionAuthor = function(section) {
    if (!section.sourceMod || section.isCustom || section.isBase) return null;
    
    if ($scope.allAvailableMods && $scope.allAvailableMods.length > 0) {
      const modData = $scope.allAvailableMods.find(function(mod) {
        return mod.modname === section.sourceMod;
      });
      if (modData) {
        // Check for username in multiple possible locations
        const username = modData.username || (modData.modData && modData.modData.username);
        if (username && username.trim() !== '') {
          return username;
        }
      }
    }
    return null;
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

  // Pack Status Functions
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

  // Progress Functions
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

  $scope.getPreparingDownloadsMessage = function() {
    if ($scope.isRateLimited) {
      return "Rate limiting due to Repo requirements";
    }
    return "Preparing downloads...";
  };

  // Button State Functions
  $scope.getPackButtonState = function(pack) {
    if (!pack) {
      return { text: 'Invalid Pack', disabled: true, class: 'disabled-btn' };
    }
    
    if (pack.isCreatePack) {
      return { text: 'Create Pack', disabled: false, class: 'create-pack-btn' };
    }
    
    if ($scope.isPackDownloading(pack)) {
      return { text: 'Downloading...', disabled: true, class: 'downloading-btn' };
    }
    
    if ($scope.packStatuses[pack.packName] && $scope.packStatuses[pack.packName].isPending) {
      return { text: 'Activating...', disabled: true, class: 'pending-btn' };
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
    if (!pack) {
      return { text: 'INVALID', class: 'disabled' };
    }
    
    if (pack.isCreatePack) {
      return { text: 'CREATE', class: 'create-pack' };
    }
    
    if ($scope.isPackDownloading(pack)) {
      return { text: 'DOWNLOADING', class: 'downloading' };
    }
    
    if ($scope.packStatuses[pack.packName] && $scope.packStatuses[pack.packName].isPending) {
      return { text: 'PENDING', class: 'pending' };
    }
    
    if ($scope.enabledPacks[pack.id]) {
      return { text: 'ENABLED', class: 'enabled' };
    }
    
    return { text: 'DISABLED', class: 'disabled' };
  };

  // Pack Actions
  $scope.togglePack = function(pack) {
    // Handle Create Pack card
    if (pack.isCreatePack) {
      // Clear selected mods when opening create pack modal
      $scope.createPackForm.selectedMods = {};
      $scope.selectedModsFilter = ''; // Clear any filter
      $scope.filteredSelectedMods = []; // Directly clear the display array
      $scope.selectedModsCurrentPage = 1;
      $scope.selectedModsTotalPages = 1;
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

  // Lua Communication
  $scope.loadDependencies = function() {
    bngApi.engineLua('extensions.repoManager.loadDependencies()');
  };
  
  $scope.requestQueueUpdate = function() {
    bngApi.engineLua('extensions.requiredMods.sendPackProgress()');
  };

  $scope.requestSubscriptionStatus = function() {
    bngApi.engineLua('extensions.repoManager.sendSubscriptionStatus()');
  };

  // Event Handlers
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
        modNames: packData.requiredMods.modNames || [],
        count: $scope.calculatePackModCount(packData.requiredMods),
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
      
      // Initialize available packs for exclusion
      $scope.initializeAvailablePacksForExclusion();
      
      setTimeout(function() {
        $scope.requestQueueUpdate();
        $scope.requestSubscriptionStatus();
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
        
        // Load all mod data so we can use proper titles in section headers
        $scope.loadingAllMods = true;
        bngApi.engineLua('extensions.repoManager.getAllAvailableMods()');
        
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
  
  $scope.$on('subscriptionStatusUpdate', function(event, statusData) {
    $scope.$apply(function() {
      if (statusData && statusData.rateLimited !== undefined) {
        $scope.isRateLimited = statusData.rateLimited;
      }
    });
  });
  
  $scope.$on('AllModsLoaded', function(event, data) {
    $scope.$apply(function() {
      $scope.allAvailableMods = (data || []).map(function(mod) {
        // Ensure author field is set for local mods (check multiple possible field names)
        if (!mod.author) {
          mod.author = mod.username || mod.creator || mod.user_name || mod.modAuthor || null;
        }
        
        // Extract username from nested modData structure if available
        if (mod.modData && mod.modData.username && !mod.username) {
          mod.username = mod.modData.username;
        }
        
        return mod;
      });
      $scope.loadingAllMods = false;
      
      // Rebuild sections now that we have mod data with proper titles
      if ($scope.dependencies && $scope.dependencies.length > 0) {
        $scope.buildModSections();
      }
      
      $scope.filterMods();
    });
  });
  
  $scope.$on('CustomPackCreated', function(event, data) {
    $scope.$apply(function() {
      if (data.success) {
        $scope.cancelCreatePack();
        $scope.loadDependencies(); // Reload to show the new pack
        // Refresh available packs for exclusion to include the new custom pack
        setTimeout(function() {
          $scope.initializeAvailablePacksForExclusion();
        }, 100);
        alert($scope.editingPack ? 'Pack updated successfully!' : 'Pack created successfully!');
      } else {
        alert('Failed to ' + ($scope.editingPack ? 'update' : 'create') + ' pack: ' + (data.error || 'Unknown error'));
      }
    });
  });
  
  $scope.$on('PackLoadedForEdit', function(event, data) {
    $scope.$apply(function() {

      if (data.success) {
        // Populate form with existing pack data
        $scope.createPackForm.name = data.pack.name;
        $scope.createPackForm.description = data.pack.description;
        $scope.createPackForm.order = data.pack.order || 999;

        // Pre-select mods that are in this pack
        $scope.createPackForm.selectedMods = {};
        
        // Wait for mods to load, then select the appropriate ones
        if ($scope.allAvailableMods.length === 0) {
          // Mods are still loading, wait for them
          const unwatch = $scope.$watch('allAvailableMods', function(newVal) {
            if (newVal && newVal.length > 0) {
              $scope.preselectPackMods(data.pack);
              unwatch(); // Stop watching
            }
          });
        } else {
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
        // Refresh available packs for exclusion to remove the deleted custom pack
        setTimeout(function() {
          $scope.initializeAvailablePacksForExclusion();
        }, 100);
        alert('Pack deleted successfully!');
      } else {
        alert('Failed to delete pack: ' + (data.error || 'Unknown error'));
      }
    });
  });
  
  // Repository mod list event handler
  $scope.$on('ModListReceived', function(event, data) {
    $scope.$apply(function() {
      $scope.loadingRepoMods = false;
      
      if (data && data.data) {
        $scope.repoMods = data.data.map(function(mod) {
          // Process mod data similar to base game repository
          mod.icon = "https://api.beamng.com/s1/v4/download/mods/" + mod.path + "icon.jpg";
          mod.downTxt = mod.download_count > 1000 ? 
            (mod.download_count / 1000).toFixed(0) + "K" : 
            mod.download_count;
          mod.rating_avg = parseFloat(mod.rating_avg || 0).toFixed(0);
          mod.filesize_display = $scope.formatFileSize(mod.filesize);
          
          // Ensure author field is set (check multiple possible field names)
          if (!mod.author) {
            mod.author = mod.username || mod.creator || mod.user_name || null;
          }
          
          return mod;
        });
        
        $scope.repoTotalPages = Math.ceil(data.count / $scope.repoModsPerPage);
      } else {
        $scope.repoMods = [];
        $scope.repoTotalPages = 1;
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
    $scope.allAvailableMods.forEach(function(mod) {
      if ((mod.tagid && modIdsToSelect.includes(mod.tagid)) ||
          (mod.modname && modNamesToSelect.includes(mod.modname))) {
        const modId = mod.tagid || mod.modname;
        $scope.createPackForm.selectedMods[modId] = mod;
      }
    });
    
    
    $scope.filterMods(); // Update filtered view
    $scope.filterSelectedMods(); // Update selected mods display
  };

  // Navigation
  $scope.goBack = function() {
    $state.go('menu.mainmenu');
  };
  
  $scope.viewCollection = function(pack) {
    $state.go('menu.mods.repository', {}, { reload: true });
  };

  // Pack Details Modal
  $scope.showPackDetails = function(pack) {
    $scope.selectedPack = pack;
    $scope.packModDetails = [];
    $scope.loadingPackDetails = true;
    $scope.showDetailsModal = true;
    $scope.currentPage = 1;
    $scope.totalPages = Math.ceil(pack.modIds.length / $scope.modsPerPage);
    $scope.requestedMods = [];
    
    // Load available mods if not already loaded for mod status checking
    if (!$scope.allAvailableMods || $scope.allAvailableMods.length === 0) {
      $scope.loadAllAvailableMods();
    }
    
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
    // Open mod info modal instead of navigating away
    $scope.openModInfo(mod);
  };
  
  // Mod Status Functions
  $scope.isModInstalledLocally = function(mod) {
    if (!mod || !mod.tagid) return false;
    
    // Check if mod exists in our local mods list
    if ($scope.allAvailableMods && $scope.allAvailableMods.length > 0) {
      return $scope.allAvailableMods.some(function(localMod) {
        return localMod.tagid === mod.tagid;
      });
    }
    
    return false;
  };
  
  $scope.isModActive = function(mod) {
    if (!mod || !mod.tagid) return false;
    
    // Check if mod is active in our local mods list
    if ($scope.allAvailableMods && $scope.allAvailableMods.length > 0) {
      const localMod = $scope.allAvailableMods.find(function(localMod) {
        return localMod.tagid === mod.tagid;
      });
      return localMod ? localMod.active : false;
    }
    
    return false;
  };

  // Get the best available icon for a mod (prefer local, fallback to repository)
  $scope.getModIcon = function(mod) {
    if (!mod) return '/ui/modModules/repoManager/icons/default-mod-icon.png';
    
    // First check if there's a local version with an icon
    if ($scope.allAvailableMods && mod.tagid) {
      const localMod = $scope.allAvailableMods.find(function(localMod) {
        return localMod.tagid === mod.tagid;
      });
      if (localMod && localMod.iconPath) {
        return localMod.iconPath;
      }
    }
    
    // Fall back to repository icon or default
    return mod.icon || '/ui/modModules/repoManager/icons/default-mod-icon.png';
  };
  
  $scope.getLocalMod = function(mod) {
    if (!mod || !mod.tagid) return null;
    
    if ($scope.allAvailableMods && $scope.allAvailableMods.length > 0) {
      return $scope.allAvailableMods.find(function(localMod) {
        return localMod.tagid === mod.tagid;
      });
    }
    
    return null;
  };

  // Mod Actions
  $scope.subscribeToMod = function(mod) {
    if (!mod || !mod.tagid) {
      console.error('Cannot subscribe to mod: missing mod or tagid');
      return;
    }
    bngApi.engineLua(`extensions.core_repository.modSubscribe('${mod.tagid}')`);
    mod.sub = true;
    mod.subscribed = true;
    mod.pending = true;
  };
  
  $scope.unsubscribeFromMod = function(mod) {
    if (!mod || !mod.tagid) {
      console.error('Cannot unsubscribe from mod: missing mod or tagid');
      return;
    }
    bngApi.engineLua(`extensions.core_repository.modUnsubscribe('${mod.tagid}')`);
    mod.sub = false;
    mod.subscribed = false;
    
    // Update local mod status if it exists
    const localMod = $scope.getLocalMod(mod);
    if (localMod) {
      localMod.active = false;
    }
  };
  
  $scope.activateMod = function(mod) {
    const localMod = $scope.getLocalMod(mod);
    if (localMod && localMod.modname) {
      bngApi.engineLua(`core_modmanager.activateMod('${localMod.modname}')`);
      localMod.active = true;
      
      // Trigger pack status update
      setTimeout(function() {
        bngApi.engineLua('extensions.repoManager.sendPackStatuses()');
      }, 100);
    }
  };
  
  $scope.deactivateMod = function(mod) {
    const localMod = $scope.getLocalMod(mod);
    if (localMod && localMod.modname) {
      bngApi.engineLua(`core_modmanager.deactivateMod('${localMod.modname}')`);
      localMod.active = false;
      
      // Trigger pack status update
      setTimeout(function() {
        bngApi.engineLua('extensions.repoManager.sendPackStatuses()');
      }, 100);
    }
  };
  
  $scope.getCacheInfo = function() {
    bngApi.engineLua('extensions.repoManager.getCacheInfo()');
  };
  
  $scope.clearCache = function() {
    bngApi.engineLua('extensions.repoManager.clearModCache()');
  };

  // Repository Browsing
  $scope.switchCreatePackTab = function(tab) {
    $scope.createPackActiveTab = tab;
    if (tab === 'repo' && $scope.repoMods.length === 0) {
      $scope.loadRepoMods();
    } else if (tab === 'selected') {
      $scope.filterSelectedMods();
    }
  };
  
  $scope.loadRepoMods = function() {
    if (!$scope.isOnlineEnabled()) {
      alert('Online features are disabled. Please enable them in game settings.');
      return;
    }
    
    $scope.loadingRepoMods = true;
    $scope.repoMods = [];
    
    const args = [
      $scope.repoFilter.query || '',
      $scope.repoFilter.orderBy,
      $scope.repoFilter.order,
      $scope.repoCurrentPage,
      $scope.repoFilter.categories || []
    ];
    
    bngApi.engineLua("extensions.repoManager.requestRepositoryMods(" + bngApi.serializeToLua(args) + ")");
  };
  
  $scope.isOnlineEnabled = function() {
    // This will be set by the online state check
    return $scope.onlineFeatures === 'enable' && $scope.onlineState;
  };
  
  $scope.applyRepoFilters = function() {
    $scope.repoCurrentPage = 1;
    $scope.loadRepoMods();
  };
  
  $scope.toggleCategory = function(categoryValue) {
    const index = $scope.repoFilter.categories.indexOf(categoryValue);
    if (index > -1) {
      $scope.repoFilter.categories.splice(index, 1);
    } else {
      $scope.repoFilter.categories.push(categoryValue);
    }
  };
  
  $scope.isCategorySelected = function(categoryValue) {
    return $scope.repoFilter.categories.includes(categoryValue);
  };
  
  $scope.selectAllCategories = function() {
    $scope.repoFilter.categories = $scope.repoCategories.map(function(cat) {
      return cat.value;
    });
  };
  
  $scope.clearAllCategories = function() {
    $scope.repoFilter.categories = [];
  };
  
  $scope.getRepoPagedMods = function() {
    return $scope.repoMods || [];
  };
  
  $scope.goToRepoPage = function(pageNumber) {
    if (pageNumber >= 1 && pageNumber <= $scope.repoTotalPages) {
      $scope.repoCurrentPage = pageNumber;
      $scope.loadRepoMods();
    }
  };
  
  $scope.previousRepoPage = function() {
    if ($scope.repoCurrentPage > 1) {
      $scope.goToRepoPage($scope.repoCurrentPage - 1);
    }
  };
  
  $scope.nextRepoPage = function() {
    if ($scope.repoCurrentPage < $scope.repoTotalPages) {
      $scope.goToRepoPage($scope.repoCurrentPage + 1);
    }
  };
  
  // Function to toggle repository mod selection
  $scope.toggleRepoModSelection = function(mod) {
    if (!mod) {
      console.error('Cannot toggle mod selection: missing mod');
      return;
    }
    const modId = mod.tagid || mod.modname || mod.id;
    if (!modId) {
      console.error('Cannot toggle mod selection: missing mod identifier');
      return;
    }
    if ($scope.createPackForm.selectedMods[modId]) {
      delete $scope.createPackForm.selectedMods[modId];
    } else {
      $scope.createPackForm.selectedMods[modId] = mod;
    }
  };
  
  // Function to open mod info in native BeamNG repository interface
  $scope.openModInfo = function(mod, event) {
    if (event) {
      event.stopPropagation(); // Prevent card selection
    }
    
    if (!mod || !mod.tagid) {
      console.error('Cannot open mod info: missing mod or tagid');
      return;
    }
    
    // Show custom modal instead of native interface
    $scope.showModInfoModal = true;
    $scope.loadingModInfo = true;
    $scope.selectedModInfo = null;
    
    // Request detailed mod information
    bngApi.engineLua('extensions.core_repository.requestMod("' + mod.tagid + '")');
  };
  
  // Function to close mod info modal
  $scope.closeModInfo = function() {
    $scope.showModInfoModal = false;
    $scope.loadingModInfo = false;
    $scope.selectedModInfo = null;
  };
  
  // Function to select/deselect mod from info modal
  $scope.selectModFromInfo = function() {
    if ($scope.selectedModInfo) {
      $scope.toggleRepoModSelection($scope.selectedModInfo);
    }
  };
  
  // Helper function to generate star array for rating display
  $scope.getStarArray = function(rating) {
    var stars = [];
    var fullStars = Math.floor(rating);
    for (var i = 0; i < 5; i++) {
      stars.push(i < fullStars);
    }
    return stars;
  };
  
  // Listen for mod info response
  $scope.$on('ModReceived', function(event, data) {
    if (data && data.data && $scope.showModInfoModal) {
      $scope.$apply(function() {
        $scope.loadingModInfo = false;
        $scope.selectedModInfo = data.data;
        
        // Ensure we have the icon URL
        if (!$scope.selectedModInfo.icon && $scope.selectedModInfo.path) {
          $scope.selectedModInfo.icon = "https://api.beamng.com/s1/v4/download/mods/" + $scope.selectedModInfo.path + "icon.jpg";
        }
        
        // Format file size
        if ($scope.selectedModInfo.filesize && !$scope.selectedModInfo.filesize_display) {
          $scope.selectedModInfo.filesize_display = $scope.formatFileSize($scope.selectedModInfo.filesize);
        }
        
        // Fix date formatting (convert Unix timestamp to proper date)
        if ($scope.selectedModInfo.last_update) {
          // Check if it's a Unix timestamp (number) and convert to Date
          var timestamp = parseInt($scope.selectedModInfo.last_update);
          if (!isNaN(timestamp) && timestamp > 0) {
            // If it looks like a Unix timestamp, convert it
            $scope.selectedModInfo.last_update_formatted = new Date(timestamp * 1000);
          } else {
            // Otherwise try to parse as date string
            $scope.selectedModInfo.last_update_formatted = new Date($scope.selectedModInfo.last_update);
          }
        }
        
        // Process description using BeamNG's BBCode parser (same as main repository)
        if ($scope.selectedModInfo.message) {
          try {
            // Use the actual BeamNG BBCode parser - same as Utils.parseBBCode
            if (typeof window.angularParseBBCode !== 'undefined') {
              $scope.selectedModInfo.message_parsed = window.angularParseBBCode($scope.selectedModInfo.message);
            } else if (typeof Utils !== 'undefined' && Utils && Utils.parseBBCode) {
              // Fallback to Utils.parseBBCode if available
              $scope.selectedModInfo.message_parsed = Utils.parseBBCode($scope.selectedModInfo.message);
            }
          } catch (error) {
            console.log('BBCode parsing failed', error);
          }
        } else {
          $scope.selectedModInfo.message_parsed = '';
        }
      });
    }
  });

  // Function to check if repository mod is selected
  $scope.isRepoModSelected = function(mod) {
    if (!mod) return false;
    const modId = mod.tagid || mod.modname || mod.id;
    if (!modId) return false;
    return !!$scope.createPackForm.selectedMods[modId];
  };
  
  // Helper function to format file sizes
  $scope.formatFileSize = function(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  };
  
  // Custom Pack Creation
  $scope.loadAllAvailableMods = function() {
    $scope.loadingAllMods = true;
    $scope.allAvailableMods = [];
    
    // Initialize available packs for exclusion if not already done
    if ($scope.availablePacksForExclusion.length === 0) {
      $scope.initializeAvailablePacksForExclusion();
    }
    
    bngApi.engineLua('extensions.repoManager.getAllAvailableMods()');
  };
  
  $scope.filterMods = function() {
    let modsToFilter = $scope.allAvailableMods;
    
    // First, exclude mods from selected packs
    if ($scope.excludedPacks.length > 0) {
      const excludedModIds = new Set();
      
      // Collect all mod IDs and names from excluded packs
      $scope.excludedPacks.forEach(function(excludedPackName) {
        const pack = $scope.dependencies.find(p => p.packName === excludedPackName);
        if (pack) {
          // Add mod IDs if they exist - ensure we have an array
          if (pack.modIds) {
            const modIdsArray = Array.isArray(pack.modIds) ? pack.modIds : Object.values(pack.modIds || {});
            modIdsArray.forEach(function(modId) {
              if (modId) excludedModIds.add(modId);
            });
          }
          // Add mod names if they exist - ensure we have an array
          if (pack.modNames) {
            const modNamesArray = Array.isArray(pack.modNames) ? pack.modNames : Object.values(pack.modNames || {});
            modNamesArray.forEach(function(modName) {
              if (modName) excludedModIds.add(modName);
            });
          }
        }
      });
      
      // Filter out excluded mods
      modsToFilter = $scope.allAvailableMods.filter(function(mod) {
        const modId = mod.tagid || mod.modname;
        return !excludedModIds.has(modId);
      });
    }
    
    // Apply mod type filters
    modsToFilter = modsToFilter.filter(function(mod) {
      const modType = $scope.getModType(mod);
      return $scope.modTypeFilters[modType];
    });
    
    // Then apply text filter
    if (!$scope.createPackFilter) {
      $scope.filteredMods = modsToFilter;
    } else {
      const filter = $scope.createPackFilter.toLowerCase();
      $scope.filteredMods = modsToFilter.filter(function(mod) {
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
  
  // Pack Exclusion
  $scope.calculatePackModCount = function(requiredMods) {
    if (!requiredMods) return 0;
    
    let modIdsCount = 0;
    let modNamesCount = 0;
    
    // Handle modIds (could be array or object from Lua)
    if (requiredMods.modIds) {
      if (Array.isArray(requiredMods.modIds)) {
        modIdsCount = requiredMods.modIds.length;
      } else if (typeof requiredMods.modIds === 'object') {
        modIdsCount = Object.keys(requiredMods.modIds).length;
      }
    }
    
    // Handle modNames (could be array or object from Lua)
    if (requiredMods.modNames) {
      if (Array.isArray(requiredMods.modNames)) {
        modNamesCount = requiredMods.modNames.length;
      } else if (typeof requiredMods.modNames === 'object') {
        modNamesCount = Object.keys(requiredMods.modNames).length;
      }
    }
    
    return modIdsCount + modNamesCount;
  };
  
  $scope.initializeAvailablePacksForExclusion = function() {
    if ($scope.dependencies && $scope.dependencies.length > 0) {
      $scope.availablePacksForExclusion = $scope.dependencies.filter(function(pack) {
        // Include packs that have mods (either modIds OR modNames), excluding the Create Pack pseudo-card
        const hasModIds = pack.modIds && (
          (Array.isArray(pack.modIds) && pack.modIds.length > 0) ||
          (typeof pack.modIds === 'object' && Object.keys(pack.modIds).length > 0)
        );
        const hasModNames = pack.modNames && (
          (Array.isArray(pack.modNames) && pack.modNames.length > 0) ||
          (typeof pack.modNames === 'object' && Object.keys(pack.modNames).length > 0)
        );
        const hasMods = hasModIds || hasModNames;
        const notCreatePack = !pack.isCreatePack;
        
        // Exclude the pack currently being edited
        const notCurrentPack = !$scope.editingPack || pack.packName !== $scope.editingPack.packName;
        
        // Recalculate count to fix any NaN issues
        pack.count = $scope.calculatePackModCount({
          modIds: pack.modIds,
          modNames: pack.modNames
        });
        
        return hasMods && notCreatePack && notCurrentPack;
      });
    }
  };
  
  $scope.togglePackExclusion = function(packName) {
    const index = $scope.excludedPacks.indexOf(packName);
    if (index > -1) {
      $scope.excludedPacks.splice(index, 1);
    } else {
      $scope.excludedPacks.push(packName);
    }
  };
  
  $scope.isPackExcluded = function(packName) {
    return $scope.excludedPacks.includes(packName);
  };
  
  $scope.selectAllPacksForExclusion = function() {
    $scope.excludedPacks = $scope.availablePacksForExclusion.map(function(pack) {
      return pack.packName;
    });
  };
  
  $scope.clearAllPackExclusions = function() {
    $scope.excludedPacks = [];
  };
  
  $scope.togglePackExclusionFilter = function() {
    $scope.showPackExclusionFilter = !$scope.showPackExclusionFilter;
    
    // Refresh available packs every time we open the exclusion filter
    if ($scope.showPackExclusionFilter) {
      $scope.initializeAvailablePacksForExclusion();
    }
  };
  
  $scope.applyPackExclusionFilter = function() {
    $scope.filterMods(); // Re-filter mods with new exclusions
  };
  
  // Mod Type Filtering Functions
  $scope.getModType = function(mod) {
    if (!mod) return 'local';
    
    // If mod has tagid, it's from the repository
    if (mod.tagid) {
      return 'repo';
    }
    
    // Check if mod is unpacked using the unpacked flag from Lua or fullpath analysis
    if (mod.unpacked === true || (mod.fullpath && !mod.fullpath.toLowerCase().endsWith('.zip'))) {
      return 'unpacked';
    }
    
    // Default to local
    return 'local';
  };
  
  $scope.toggleModTypeFilter = function(type) {
    $scope.modTypeFilters[type] = !$scope.modTypeFilters[type];
    $scope.filterMods();
  };
  
  $scope.isModTypeEnabled = function(type) {
    return $scope.modTypeFilters[type];
  };
  
  $scope.getModTypeCount = function(type) {
    if (!$scope.allAvailableMods || $scope.allAvailableMods.length === 0) {
      return 0;
    }
    
    return $scope.allAvailableMods.filter(function(mod) {
      return $scope.getModType(mod) === type;
    }).length;
  };
  
  // Function to get repository information for local mods with tagid
  $scope.hasRepoInfo = function(mod) {
    return mod && mod.tagid && (mod.download_count || mod.rating_avg || mod.filesize);
  };
  
  $scope.getRepoInfoDisplay = function(mod) {
    if (!mod || !mod.tagid) return null;
    
    const info = [];
    
    if (mod.download_count) {
      const downTxt = mod.download_count > 1000 ? 
        (mod.download_count / 1000).toFixed(0) + "K" : 
        mod.download_count;
      info.push(downTxt + " downloads");
    }
    
    if (mod.rating_avg && mod.rating_avg > 0) {
      info.push("★ " + parseFloat(mod.rating_avg).toFixed(1));
    }
    
    if (mod.filesize) {
      info.push($scope.formatFileSize(mod.filesize));
    }
    
    return info.length > 0 ? info : null;
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
      order: parseInt($scope.createPackForm.order) || 999,
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
      order: 999,
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
  
  $scope.updateModsPagination = function() {
    // Convert to number to ensure proper calculation
    $scope.createPackModsPerPage = parseInt($scope.createPackModsPerPage);
    
    // Recalculate total pages
    $scope.createPackTotalPages = Math.ceil($scope.filteredMods.length / $scope.createPackModsPerPage);
    
    // Reset to first page if current page is now invalid
    if ($scope.createPackCurrentPage > $scope.createPackTotalPages) {
      $scope.createPackCurrentPage = 1;
    }
    
    // Ensure we're on at least page 1
    if ($scope.createPackCurrentPage < 1) {
      $scope.createPackCurrentPage = 1;
    }
  };
  
  // Selected Mods Tab
  $scope.filterSelectedMods = function() {
    const selectedMods = Object.values($scope.createPackForm.selectedMods);
    
    if (!$scope.selectedModsFilter) {
      $scope.filteredSelectedMods = selectedMods;
    } else {
      const filter = $scope.selectedModsFilter.toLowerCase();
      $scope.filteredSelectedMods = selectedMods.filter(function(mod) {
        return (mod.title && mod.title.toLowerCase().includes(filter)) ||
               (mod.name && mod.name.toLowerCase().includes(filter)) ||
               (mod.modname && mod.modname.toLowerCase().includes(filter)) ||
               (mod.author && mod.author.toLowerCase().includes(filter)) ||
               (mod.tagid && mod.tagid.toLowerCase().includes(filter));
      });
    }
    $scope.selectedModsTotalPages = Math.ceil($scope.filteredSelectedMods.length / $scope.selectedModsPerPage);
    $scope.selectedModsCurrentPage = 1;
  };
  
  $scope.updateSelectedModsPagination = function() {
    // Convert to number to ensure proper calculation
    $scope.selectedModsPerPage = parseInt($scope.selectedModsPerPage);
    
    // Recalculate total pages
    $scope.selectedModsTotalPages = Math.ceil($scope.filteredSelectedMods.length / $scope.selectedModsPerPage);
    
    // Reset to first page if current page is now invalid
    if ($scope.selectedModsCurrentPage > $scope.selectedModsTotalPages) {
      $scope.selectedModsCurrentPage = 1;
    }
    
    // Ensure we're on at least page 1
    if ($scope.selectedModsCurrentPage < 1) {
      $scope.selectedModsCurrentPage = 1;
    }
  };
  
  $scope.getPagedSelectedMods = function() {
    if (!$scope.filteredSelectedMods || $scope.filteredSelectedMods.length === 0) {
      return [];
    }
    const startIndex = ($scope.selectedModsCurrentPage - 1) * $scope.selectedModsPerPage;
    const endIndex = Math.min(startIndex + $scope.selectedModsPerPage, $scope.filteredSelectedMods.length);
    return $scope.filteredSelectedMods.slice(startIndex, endIndex);
  };
  
  $scope.goToSelectedModsPage = function(pageNumber) {
    if (pageNumber >= 1 && pageNumber <= $scope.selectedModsTotalPages) {
      $scope.selectedModsCurrentPage = pageNumber;
    }
  };
  
  $scope.previousSelectedModsPage = function() {
    if ($scope.selectedModsCurrentPage > 1) {
      $scope.goToSelectedModsPage($scope.selectedModsCurrentPage - 1);
    }
  };
  
  $scope.nextSelectedModsPage = function() {
    if ($scope.selectedModsCurrentPage < $scope.selectedModsTotalPages) {
      $scope.goToSelectedModsPage($scope.selectedModsCurrentPage + 1);
    }
  };
  
  $scope.removeModFromSelection = function(mod) {
    const modId = mod.tagid || mod.modname;
    if ($scope.createPackForm.selectedMods[modId]) {
      delete $scope.createPackForm.selectedMods[modId];
      $scope.filterSelectedMods(); // Refresh the filtered list
    }
  };
  
  $scope.clearAllSelectedMods = function() {
    if (confirm('Are you sure you want to clear all selected mods?')) {
      $scope.createPackForm.selectedMods = {};
      $scope.filterSelectedMods(); // Refresh the filtered list
    }
  };
  
  // Custom Pack Management
  $scope.isCustomPack = function(pack) {
    // Custom packs are those without a source mod
    const section = $scope.modSections.find(s => s.isCustom);
    return section && section.packs.includes(pack) && !pack.isCreatePack;
  };
  
  $scope.editCustomPack = function(pack) {
    if (!$scope.isCustomPack(pack)) return;

    $scope.editingPack = pack;
    $scope.showCreatePackModal = true;
    $scope.loadAllAvailableMods();
    
    // Load the pack data first, then the UI will be updated with the pack's mods
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
      order: parseInt($scope.createPackForm.order) || 999,
      modIds: modIds,
      modNames: modNames
    };
    
    const jsonString = JSON.stringify(packData).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    bngApi.engineLua(`extensions.repoManager.updateCustomPack("${jsonString}")`);
  };

  $scope.$on('ModReceived', function(event, data) {
    $scope.$apply(function() {
      if (data && data.data && data.data.tagid && $scope.requestedMods.includes(data.data.tagid)) {
        const modData = data.data;
        
        // First check if there's a local version of this mod with an icon
        let localIcon = null;
        if ($scope.allAvailableMods && modData.tagid) {
          const localMod = $scope.allAvailableMods.find(mod => mod.tagid === modData.tagid);
          if (localMod && localMod.iconPath) {
            localIcon = localMod.iconPath;
          }
        }
        
        // Use local icon if available, otherwise fall back to original logic
        if (localIcon) {
          modData.icon = localIcon;
        } else if (modData.isLocal && modData.localIconPath) {
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

  // Initialization
  $scope.loadEnabledState();
  $scope.loadExpandedState();
  $scope.loadDependencies();
  
  // Check online features state
  bngApi.engineLua('settings.getValue("onlineFeatures")', function(data) {
    $scope.$apply(function() {
      $scope.onlineFeatures = data;
    });
  });
  
  bngApi.engineLua('Engine.Online.isAuthenticated()', function(data) {
    $scope.$apply(function() {
      $scope.onlineState = data;
    });
  });
  
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
  
  // Subscription status check interval
  const statusInterval = setInterval(function() {
    $scope.requestSubscriptionStatus();
  }, 5000);
  $scope._intervals.push(statusInterval);
  
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