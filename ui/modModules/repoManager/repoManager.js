'use strict'

angular.module('beamng.stuff')

.filter('trusted', ['$sce', function($sce) {
  return function(html) {
    if (!html) return '';
    return $sce.trustAsHtml(html);
  };
}])

.controller('RepoManagerController', ['$scope', '$state', '$sanitize', function($scope, $state, $sanitize) {
  $scope.dependencies = [];
  $scope.loading = true;
  $scope.enabledPacks = {};
  $scope.packStatuses = {};
  
  $scope.packQueue = [];
  $scope.currentPack = null;
  $scope.packModCount = 0;
  $scope.packModDone = 0;
  
  $scope.currentDownloadStates = [];
  
  $scope.isRateLimited = false;
  
  $scope.currentDownloadPack = null;
  
  $scope.cancelRequestedForPack = null;
  $scope.cancelAllRequested = false;
  
  $scope.selectedPack = null;
  $scope.packModDetails = [];
  $scope.loadingPackDetails = false;
  $scope.showDetailsModal = false;
  $scope.currentPage = 1;
  $scope.modsPerPage = 12;
  $scope.totalPages = 1;
  $scope.requestedMods = [];
  $scope.loadedModsCount = 0;
  
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
  $scope.editingPack = null;
  
  $scope.createPackActiveTab = 'local';
  $scope.repoMods = [];
  $scope.loadingRepoMods = false;
  $scope.repoCurrentPage = 1;
  $scope.repoTotalPages = 1;
  $scope.repoModsPerPage = 12;
  
  $scope.selectedModsFilter = '';
  $scope.filteredSelectedMods = [];
  $scope.selectedModsPerPage = 10;
  $scope.selectedModsCurrentPage = 1;
  $scope.selectedModsTotalPages = 1;
  $scope.requestedSelectedMods = [];
  
  $scope.showPackExclusionFilter = false;
  $scope.excludedPacks = [];
  $scope.availablePacksForExclusion = [];
  
  $scope.modTypeFilters = {
    local: true,
    unpacked: true,
    repo: true
  };
  $scope.repoFilter = {
    query: '',
    orderBy: 'update',
    order: 'desc',
    categories: [3, 4, 5, 6, 7, 8, 9, 10, 12, 13, 15],
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
  
  $scope.showSortByDropdown = false;
  $scope.showOrderDropdown = false;
  $scope.showLocalModsPerPageDropdown = false;
  $scope.showSelectedModsPerPageDropdown = false;
  
  $scope.showModInfoModal = false;
  $scope.loadingModInfo = false;
  $scope.selectedModInfo = null;
  $scope.modInfoFromPackCreator = false;
  
  $scope.showDeleteConfirmModal = false;
  $scope.packToDelete = null;
  
  $scope.packToMod = {};
  $scope.baseMod = null;
  $scope.modToPacks = {};
  $scope.modSections = [];
  $scope.expandedSections = {};
  
  $scope.fetchingRepoMetadata = false;
  $scope.repoMetadataQueue = [];
  $scope.requestedRepoMetadata = [];
  
  $scope._intervals = [];
  $scope._timeouts = [];

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

  $scope.buildModSections = function() {
    const sections = {};
    
    if ($scope.dependencies && $scope.dependencies.length > 0) {
      $scope.dependencies.forEach(function(pack) {
        const sourceMod = $scope.packToMod[pack.packName];
        let modName = sourceMod;
        
        if (sourceMod === $scope.baseMod) {
          modName = 'Base';
        } else if (!sourceMod) {
          modName = 'Custom';
        } else {
          if ($scope.allAvailableMods && $scope.allAvailableMods.length > 0) {
            const modData = $scope.allAvailableMods.find(function(mod) {
              return mod.modname === sourceMod;
            });
            if (modData) {
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
          
          if ($scope.allAvailableMods && $scope.allAvailableMods.length > 0 && sourceMod) {
            const modData = $scope.allAvailableMods.find(function(mod) {
              return mod.modname === sourceMod;
            });
            if (modData) {
              const username = modData.username || (modData.modData && modData.modData.username);
              if (username && username.trim() !== '') {
                sections[modName].authorUsername = username;
              }
            }
          }
        }
        
        sections[modName].packs.push(pack);
      });
    }
    
    if (!sections['Custom']) {
      sections['Custom'] = {
        modName: 'Custom',
        sourceMod: null,
        packs: [],
        isBase: false,
        isCustom: true
      };
    }
    
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
    
    $scope.modSections = Object.values(sections).sort(function(a, b) {
      if (a.isCustom) return -1;
      if (b.isCustom) return 1;
      if (a.isBase) return -1;
      if (b.isBase) return 1;
      return a.modName.localeCompare(b.modName);
    });
    
    $scope.modSections.forEach(function(section) {
      if ($scope.expandedSections[section.modName] === undefined) {
        $scope.expandedSections[section.modName] = section.isBase || section.isCustom;
      }
    });
    
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
    
    const realPacks = section.packs.filter(function(pack) {
      return !pack.isCreatePack;
    });
    
    if (realPacks.length === 0) return;
    
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
  
  $scope.getSectionAuthor = function(section) {
    if (!section.sourceMod || section.isCustom || section.isBase) return null;
    
    if (section.authorUsername) {
      return section.authorUsername;
    }
    
    if ($scope.allAvailableMods && $scope.allAvailableMods.length > 0) {
      const modData = $scope.allAvailableMods.find(function(mod) {
        return mod.modname === section.sourceMod;
      });
      if (modData) {
        const username = modData.username || (modData.modData && modData.modData.username);
        if (username && username.trim() !== '') {
          section.authorUsername = username;
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
    
    const workingStates = $scope.currentDownloadStates.filter(function(state) {
      return state && state.state === 'working';
    });
    
    if (workingStates.length === 0) {
      return [];
    }
    
    const downloadingMods = [];
    const addedModIds = new Set();
    
    workingStates.forEach(function(state) {
      if (state.id && pack.modIds.includes(state.id) && !addedModIds.has(state.id)) {
        downloadingMods.push($scope.createModProgressData(state, state.id));
        addedModIds.add(state.id);
      }
    });
    
    if (downloadingMods.length < workingStates.length) {
      workingStates.forEach(function(state) {
        if (state.id && addedModIds.has(state.id)) return;
        
        let matchingModId = null;
        
        if (state.filename) {
          matchingModId = pack.modIds.find(function(modId) {
            const matches = !addedModIds.has(modId) && state.filename.includes(modId);
            return matches;
          });
        }
        
        if (!matchingModId && state.uri) {
          matchingModId = pack.modIds.find(function(modId) {
            const matches = !addedModIds.has(modId) && state.uri.includes(modId);
            return matches;
          });
        }
        
        if (!matchingModId) {
          matchingModId = pack.modIds.find(function(modId) {
            if (addedModIds.has(modId)) return false;
            
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
      return "Rate limiting due to Repo requirements, Downloads will continue shortly";
    }
    return "Preparing downloads...";
  };

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

  $scope.togglePack = function(pack) {
    if ((!$scope.allAvailableMods || $scope.allAvailableMods.length === 0) && !$scope.loadingAllMods) {
      $scope.loadAllAvailableMods();
    }
    
    if (pack.isCreatePack) {
      $scope.createPackForm.selectedMods = {};
      $scope.selectedModsFilter = '';
      $scope.filteredSelectedMods = [];
      $scope.selectedModsCurrentPage = 1;
      $scope.selectedModsTotalPages = 1;
      $scope.showCreatePackModal = true;
      $scope.loadAllAvailableMods();
      
      setTimeout(function() {
        if ($scope.createPackActiveTab === 'local') {
          const displayedMods = $scope.getPagedMods();
          $scope.fetchRepositoryMetadataForDisplayed(displayedMods, 'Create Pack modal open');
        }
      }, 500);
      
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

  $scope.cancelAllDownloads = function() {
    $scope.cancelAllRequested = true;
    bngApi.engineLua('extensions.requiredMods.cancelAllDownloads()');
  };

  $scope.cancelCurrentDownload = function() {
    $scope.cancelRequestedForPack = $scope.currentPack;
    bngApi.engineLua('extensions.requiredMods.cancelDownload()');
  };

  $scope.isCancellingCurrentPack = function() {
    return $scope.cancelRequestedForPack && 
           $scope.currentPack && 
           $scope.cancelRequestedForPack === $scope.currentPack;
  };

  $scope.getCancelStatusMessage = function() {
    if ($scope.cancelAllRequested && $scope.isAnyPackDownloading()) {
      return "Completing final downloads and canceling all packs...";
    }
    if ($scope.isCancellingCurrentPack()) {
      return "Completing final downloads and canceling...";
    }
    return null;
  };

  $scope.getDeactivateAllButtonText = function() {
    if ($scope.cancelAllRequested && $scope.isAnyPackDownloading()) {
      return 'Canceling All Downloads...';
    }
    if ($scope.isAnyPackDownloading()) {
      return 'Cancel All Downloads';
    }
    return 'Deactivate All Packs';
  };

  $scope.getDeactivateAllButtonSubText = function() {
    if ($scope.cancelAllRequested && $scope.isAnyPackDownloading()) {
      return 'Stopping all downloads in progress';
    }
    if ($scope.isAnyPackDownloading()) {
      return 'Stop all pending downloads';
    }
    return 'Disable all dependency packs';
  };

  $scope.handleDeactivateAllAction = function() {
    if ($scope.isAnyPackDownloading()) {
      if (!$scope.cancelAllRequested) {
        $scope.cancelAllDownloads();
      }
    } else {
      $scope.uninstallAllPacks();
    }
  };

  $scope.loadDependencies = function() {
    bngApi.engineLua('extensions.repoManager.loadDependencies()');
  };
  
  $scope.requestQueueUpdate = function() {
    bngApi.engineLua('extensions.requiredMods.sendPackProgress()');
  };

  $scope.requestSubscriptionStatus = function() {
    bngApi.engineLua('extensions.repoManager.sendSubscriptionStatus()');
  };

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
    
    $scope.dependencies.sort(function(a, b) {
      return a.order - b.order;
    });
    
    $scope.loading = false;
      $scope.saveEnabledState();
      
      $scope.updateCurrentDownloadPack();
      
      if ($scope.packToMod && Object.keys($scope.packToMod).length > 0) {
        $scope.buildModSections();
      }
      
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
      
      if ($scope.allAvailableMods && $scope.allAvailableMods.length > 0) {
        bngApi.engineLua('extensions.repoManager.getAllAvailableMods()');
      }
    });
  });
  
  $scope.$on('ModAssociationLoaded', function(event, data) {
    $scope.$apply(function() {
      if (data) {
        $scope.packToMod = data.packToMod || {};
        $scope.baseMod = data.baseMod;
        $scope.modToPacks = data.modToPacks || {};
        
        $scope.loadingAllMods = true;
        bngApi.engineLua('extensions.repoManager.getAllAvailableMods()');
        
        if ($scope.dependencies && $scope.dependencies.length > 0) {
          $scope.buildModSections();
        }
      }
    });
  });
  
  $scope.$on('packQueueUpdate', function(event, queueData) {
    $scope.$apply(function() {
      const previousPack = $scope.currentPack;
      
      if (queueData && queueData.packQueue !== undefined && (Array.isArray(queueData.packQueue) || typeof queueData.packQueue === 'object')) {
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
      
      if (previousPack !== $scope.currentPack || !$scope.currentPack) {
        $scope.cancelRequestedForPack = null;
      }
      
      if (!$scope.currentPack) {
        $scope.cancelAllRequested = false;
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
      const previousModCount = $scope.allAvailableMods ? $scope.allAvailableMods.length : 0;
      
      $scope.allAvailableMods = (data || []).map(function(mod) {
        if (!mod.author) {
          mod.author = mod.username || mod.creator || mod.user_name || mod.modAuthor || null;
        }
        
        if (mod.modData && mod.modData.username && !mod.username) {
          mod.username = mod.modData.username;
        }
        
        return mod;
      });
      $scope.loadingAllMods = false;
      
      $scope.loadRepositoryMetadataCache();
      
      const currentModCount = $scope.allAvailableMods.length;
      if ($scope.dependencies && $scope.dependencies.length > 0 && 
          (previousModCount === 0 || currentModCount !== previousModCount || !$scope.modSections || $scope.modSections.length === 0)) {
        $scope.buildModSections();
      }
      
      if ($scope.showCreatePackModal) {
        $scope.filterMods();
      }
      
    });
  });
  
  $scope.$on('CustomPackCreated', function(event, data) {
    $scope.$apply(function() {
      if (data.success) {
        $scope.cancelCreatePack();
        $scope.loadDependencies();
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
        $scope.createPackForm.name = data.pack.name;
        $scope.createPackForm.description = data.pack.description;
        $scope.createPackForm.order = data.pack.order || 999;

        $scope.createPackForm.selectedMods = {};
        
        if ($scope.allAvailableMods.length === 0) {
          const unwatch = $scope.$watch('allAvailableMods', function(newVal) {
            if (newVal && newVal.length > 0) {
              $scope.preselectPackMods(data.pack);
              unwatch();
            }
          });
        } else {
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
        $scope.loadDependencies();
        setTimeout(function() {
          $scope.initializeAvailablePacksForExclusion();
        }, 100);
        alert('Pack deleted successfully!');
      } else {
        alert('Failed to delete pack: ' + (data.error || 'Unknown error'));
      }
    });
  });
  
  $scope.$on('ModListReceived', function(event, data) {
    $scope.$apply(function() {
      $scope.loadingRepoMods = false;
      
      if (data && data.data) {
        $scope.repoMods = data.data.map(function(mod) {
          mod.icon = "https://api.beamng.com/s1/v4/download/mods/" + mod.path + "icon.jpg";
          mod.downTxt = mod.download_count > 1000 ? 
            (mod.download_count / 1000).toFixed(0) + "K" : 
            mod.download_count;
          mod.rating_avg = parseFloat(mod.rating_avg || 0).toFixed(0);
          mod.filesize_display = $scope.formatFileSize(mod.filesize);
          
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
    $scope.createPackForm.selectedMods = {};
    
    const modIdsToSelect = Array.isArray(pack.modIds) ? pack.modIds : (pack.modIds ? Object.values(pack.modIds) : []);
    const modNamesToSelect = Array.isArray(pack.modNames) ? pack.modNames : (pack.modNames ? Object.values(pack.modNames) : []);
    
    const missingModIds = [];
    
    $scope.allAvailableMods.forEach(function(mod) {
      if ((mod.tagid && modIdsToSelect.includes(mod.tagid)) ||
          (mod.modname && modNamesToSelect.includes(mod.modname))) {
        const modId = mod.tagid || mod.modname;
        $scope.createPackForm.selectedMods[modId] = mod;
      }
    });
    
    modIdsToSelect.forEach(function(modId) {
      if (!$scope.createPackForm.selectedMods[modId]) {
        missingModIds.push(modId);
      }
    });
    
    modNamesToSelect.forEach(function(modName) {
      if (!$scope.createPackForm.selectedMods[modName]) {
        const localMod = $scope.allAvailableMods.find(mod => mod.modname === modName);
        if (!localMod) {
          missingModIds.push(modName);
        }
      }
    });
    
    if (missingModIds.length > 0) {
      console.log(`Pack editing: Found ${Object.keys($scope.createPackForm.selectedMods).length} mods locally, fetching ${missingModIds.length} from repository`);
    }
    
    if (missingModIds.length > 0) {
      missingModIds.forEach(function(modId, index) {
        $scope.createPackForm.selectedMods[modId] = {
          tagid: modId,
          title: `Loading Mod ${index + 1}...`,
          author: 'Fetching from repository...',
          isLoading: true,
          loadingProgress: 'Requesting mod data...',
          icon: '/ui/modModules/repoManager/icons/default-mod-icon.png'
        };
      });
      
      $scope.fetchMissingPackMods(missingModIds);
    }
    
    $scope.filterMods();
    $scope.filterSelectedMods();
  };

  $scope.fetchMissingPackMods = function(missingModIds) {
    if (!missingModIds || missingModIds.length === 0) return;
    
    console.log('Starting to fetch missing pack mods:', missingModIds);
    $scope.requestedSelectedMods = [...missingModIds];
    
    const fetchModWithDelay = function(index) {
      if (index >= missingModIds.length) {
        console.log('Finished fetching all missing pack mods');
        return;
      }
      
      const modId = missingModIds[index];
      console.log(`Fetching mod ${index + 1}/${missingModIds.length}: ${modId}`);
      
      if ($scope.createPackForm.selectedMods[modId] && $scope.createPackForm.selectedMods[modId].isLoading) {
        $scope.createPackForm.selectedMods[modId].loadingProgress = `Fetching mod ${index + 1} of ${missingModIds.length}...`;
        $scope.createPackForm.selectedMods[modId].title = `Loading: ${modId}`;
        $scope.$apply();
      }
      
      bngApi.engineLua(`extensions.core_repository.requestMod('${modId}')`);
      
      setTimeout(function() {
        fetchModWithDelay(index + 1);
      }, 500);
    };
    
    fetchModWithDelay(0);
  };

  $scope.goBack = function() {
    $state.go('menu.mainmenu');
  };
  
  $scope.viewCollection = function(pack) {
    $state.go('menu.mods.repository', {}, { reload: true });
  };

  $scope.showPackDetails = function(pack) {
    $scope.selectedPack = pack;
    $scope.packModDetails = [];
    $scope.loadingPackDetails = true;
    $scope.showDetailsModal = true;
    $scope.currentPage = 1;
    $scope.totalPages = Math.ceil(pack.modIds.length / $scope.modsPerPage);
    $scope.requestedMods = [];
    
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
    $scope.openModInfo(mod);
  };
  
  $scope.isModInstalledLocally = function(mod) {
    if (!mod || !mod.tagid) return false;
    
    if ($scope.allAvailableMods && $scope.allAvailableMods.length > 0) {
      return $scope.allAvailableMods.some(function(localMod) {
        return localMod.tagid === mod.tagid;
      });
    }
    
    return false;
  };
  
  $scope.isModActive = function(mod) {
    if (!mod || !mod.tagid) return false;
    
    if ($scope.allAvailableMods && $scope.allAvailableMods.length > 0) {
      const localMod = $scope.allAvailableMods.find(function(localMod) {
        return localMod.tagid === mod.tagid;
      });
      return localMod ? localMod.active : false;
    }
    
    return false;
  };

  $scope.getModIcon = function(mod) {
    if (!mod) return '/ui/modModules/repoManager/icons/default-mod-icon.png';
    
    if ($scope.allAvailableMods && mod.tagid) {
      const localMod = $scope.allAvailableMods.find(function(localMod) {
        return localMod.tagid === mod.tagid;
      });
      if (localMod && localMod.iconPath) {
        return localMod.iconPath;
      }
    }
    
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

  $scope.fetchRepositoryMetadata = function() {
    const displayedMods = $scope.getPagedMods();
    $scope.fetchRepositoryMetadataForDisplayed(displayedMods, 'manual refresh');
  };

  $scope.refreshRepositoryMetadata = function() {
    console.log('Manual repository metadata refresh triggered');
    
    localStorage.removeItem('repoManager_metadataCache');
    
    $scope.fetchingRepoMetadata = false;
    $scope.requestedRepoMetadata = [];
    $scope.repoMetadataQueue = [];
    
    $scope.fetchRepositoryMetadata();
  };

  $scope.switchCreatePackTab = function(tab) {
    $scope.createPackActiveTab = tab;
    if (tab === 'repo' && $scope.repoMods.length === 0) {
      $scope.loadRepoMods();
    } else if (tab === 'selected') {
      $scope.filterSelectedMods();
    } else if (tab === 'local') {
      setTimeout(function() {
        const displayedMods = $scope.getPagedMods();
        $scope.fetchRepositoryMetadataForDisplayed(displayedMods, 'Local Mods tab switch');
      }, 100);
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
    
    if ($scope.createPackActiveTab === 'selected') {
      $scope.filterSelectedMods();
    }
  };
  
  $scope.openModInfo = function(mod, event, fromPackCreator) {
    if (event) {
      event.stopPropagation();
    }
    
    if (!mod || !mod.tagid) {
      console.error('Cannot open mod info: missing mod or tagid');
      return;
    }
    
    $scope.showModInfoModal = true;
    $scope.loadingModInfo = true;
    $scope.selectedModInfo = null;
    $scope.modInfoFromPackCreator = fromPackCreator || false;
    
    bngApi.engineLua('extensions.core_repository.requestMod("' + mod.tagid + '")');
  };
  
  $scope.closeModInfo = function() {
    $scope.showModInfoModal = false;
    $scope.loadingModInfo = false;
    $scope.selectedModInfo = null;
    $scope.modInfoFromPackCreator = false;
  };
  
  $scope.selectModFromInfo = function() {
    if ($scope.selectedModInfo) {
      $scope.toggleRepoModSelection($scope.selectedModInfo);
    }
  };
  
  $scope.getStarArray = function(rating) {
    var stars = [];
    var fullStars = Math.floor(rating);
    for (var i = 0; i < 5; i++) {
      stars.push(i < fullStars);
    }
    return stars;
  };
  
  $scope.$on('ModReceived', function(event, data) {
    if (data && data.data && $scope.showModInfoModal) {
      $scope.$apply(function() {
        $scope.loadingModInfo = false;
        $scope.selectedModInfo = data.data;
        
        if (!$scope.selectedModInfo.icon && $scope.selectedModInfo.path) {
          $scope.selectedModInfo.icon = "https://api.beamng.com/s1/v4/download/mods/" + $scope.selectedModInfo.path + "icon.jpg";
        }
        
        if ($scope.selectedModInfo.filesize && !$scope.selectedModInfo.filesize_display) {
          $scope.selectedModInfo.filesize_display = $scope.formatFileSize($scope.selectedModInfo.filesize);
        }
        
        if ($scope.selectedModInfo.last_update) {
          var timestamp = parseInt($scope.selectedModInfo.last_update);
          if (!isNaN(timestamp) && timestamp > 0) {
            $scope.selectedModInfo.last_update_formatted = new Date(timestamp * 1000);
          } else {
            $scope.selectedModInfo.last_update_formatted = new Date($scope.selectedModInfo.last_update);
          }
        }
        
        if ($scope.selectedModInfo.message) {
          try {
            if (typeof window.angularParseBBCode !== 'undefined') {
              $scope.selectedModInfo.message_parsed = window.angularParseBBCode($scope.selectedModInfo.message);
            } else if (typeof Utils !== 'undefined' && Utils && Utils.parseBBCode) {
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

  $scope.isRepoModSelected = function(mod) {
    if (!mod) return false;
    const modId = mod.tagid || mod.modname || mod.id;
    if (!modId) return false;
    return !!$scope.createPackForm.selectedMods[modId];
  };
  
  $scope.formatFileSize = function(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  };
  
  $scope.loadAllAvailableMods = function() {
    if (!$scope.allAvailableMods || $scope.allAvailableMods.length === 0) {
      $scope.loadingAllMods = true;
      $scope.allAvailableMods = [];
    }
    
    if ($scope.availablePacksForExclusion.length === 0) {
      $scope.initializeAvailablePacksForExclusion();
    }
    
    bngApi.engineLua('extensions.repoManager.getAllAvailableMods()');
  };
  
  $scope.filterMods = function() {
    let modsToFilter = $scope.allAvailableMods;
    
    if ($scope.excludedPacks.length > 0) {
      const excludedModIds = new Set();
      
      $scope.excludedPacks.forEach(function(excludedPackName) {
        const pack = $scope.dependencies.find(p => p.packName === excludedPackName);
        if (pack) {
          if (pack.modIds) {
            const modIdsArray = Array.isArray(pack.modIds) ? pack.modIds : Object.values(pack.modIds || {});
            modIdsArray.forEach(function(modId) {
              if (modId) excludedModIds.add(modId);
            });
          }
          if (pack.modNames) {
            const modNamesArray = Array.isArray(pack.modNames) ? pack.modNames : Object.values(pack.modNames || {});
            modNamesArray.forEach(function(modName) {
              if (modName) excludedModIds.add(modName);
            });
          }
        }
      });
      
      modsToFilter = $scope.allAvailableMods.filter(function(mod) {
        const modId = mod.tagid || mod.modname;
        return !excludedModIds.has(modId);
      });
    }
    
    modsToFilter = modsToFilter.filter(function(mod) {
      const modType = $scope.getModType(mod);
      return $scope.modTypeFilters[modType];
    });
    
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

    setTimeout(function() {
      const displayedMods = $scope.getPagedMods();
      $scope.fetchRepositoryMetadataForDisplayed(displayedMods, 'Local Mods tab');
    }, 100);
  };
  
  $scope.calculatePackModCount = function(requiredMods) {
    if (!requiredMods) return 0;
    
    let modIdsCount = 0;
    let modNamesCount = 0;
    
    if (requiredMods.modIds) {
      if (Array.isArray(requiredMods.modIds)) {
        modIdsCount = requiredMods.modIds.length;
      } else if (typeof requiredMods.modIds === 'object') {
        modIdsCount = Object.keys(requiredMods.modIds).length;
      }
    }
    
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
        
        const notCurrentPack = !$scope.editingPack || pack.packName !== $scope.editingPack.packName;
        
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
    
    if ($scope.showPackExclusionFilter) {
      $scope.initializeAvailablePacksForExclusion();
    }
  };
  
  $scope.applyPackExclusionFilter = function() {
    $scope.filterMods();
  };
  
  $scope.getModType = function(mod) {
    if (!mod) return 'local';
    
    if (mod.tagid) {
      return 'repo';
    }
    
    if (mod.unpacked === true || (mod.fullpath && !mod.fullpath.toLowerCase().endsWith('.zip'))) {
      return 'unpacked';
    }
    
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
  
  $scope.hasRepoInfo = function(mod) {
    return mod && mod.tagid && (mod.download_count || mod.rating_avg || mod.filesize);
  };
  
  $scope.getRepoInfoDisplay = function(mod) {
    if (!mod || !mod.tagid) return null;
    
    const info = [];
    
    if (mod.rating_avg && mod.rating_avg > 0) {
      info.push("★ " + parseFloat(mod.rating_avg).toFixed(1));
    }
    
    return info.length > 0 ? info : null;
  };

  $scope.identifyDisplayedModsNeedingMetadata = function(modList) {
    if (!modList || modList.length === 0) return [];
    
    const modsNeedingMetadata = [];
    
    modList.forEach(function(mod) {
      if (mod.tagid && !$scope.hasRepoInfo(mod)) {
        if (!$scope.requestedRepoMetadata.includes(mod.tagid)) {
          modsNeedingMetadata.push(mod.tagid);
        }
      }
    });
    
    return modsNeedingMetadata;
  };

  $scope.fetchRepositoryMetadataForDisplayed = function(modList, context) {
    const modsToFetch = $scope.identifyDisplayedModsNeedingMetadata(modList);
    
    if (modsToFetch.length === 0) {
      return;
    }
    
    console.log(`Fetching metadata for ${modsToFetch.length} displayed mods in ${context}`);
    
    if (!$scope.fetchingRepoMetadata) {
      $scope.fetchingRepoMetadata = true;
      $scope.repoMetadataQueue = [...modsToFetch];
      $scope.requestedRepoMetadata.push(...modsToFetch);
      
      $scope.fetchNextRepoMetadata();
    } else {
      modsToFetch.forEach(function(modId) {
        if (!$scope.requestedRepoMetadata.includes(modId)) {
          $scope.repoMetadataQueue.push(modId);
          $scope.requestedRepoMetadata.push(modId);
        }
      });
    }
  };

  $scope.fetchNextRepoMetadata = function() {
    if ($scope.repoMetadataQueue.length === 0) {
      console.log('Finished fetching repository metadata for all mods');
      $scope.fetchingRepoMetadata = false;
      $scope.cacheRepositoryMetadata();
      return;
    }
    
    const modId = $scope.repoMetadataQueue.shift();
    console.log(`Fetching repository metadata for ${modId} (${$scope.repoMetadataQueue.length + 1} remaining)`);
    
    bngApi.engineLua(`extensions.core_repository.requestMod('${modId}')`);
    
    setTimeout(function() {
      $scope.fetchNextRepoMetadata();
    }, 750);
  };

  $scope.cacheRepositoryMetadata = function() {
    if (!$scope.allAvailableMods) return;
    
    const metadataCache = {};
    
    $scope.allAvailableMods.forEach(function(mod) {
      if (mod.tagid && $scope.hasRepoInfo(mod)) {
        metadataCache[mod.tagid] = {
          download_count: mod.download_count,
          rating_avg: mod.rating_avg,
          filesize: mod.filesize,
          cached_at: Date.now()
        };
      }
    });
    
    localStorage.setItem('repoManager_metadataCache', JSON.stringify(metadataCache));
    console.log(`Cached repository metadata for ${Object.keys(metadataCache).length} mods`);
  };

  $scope.loadRepositoryMetadataCache = function() {
    const cached = localStorage.getItem('repoManager_metadataCache');
    if (!cached) return;
    
    try {
      const metadataCache = JSON.parse(cached);
      let appliedCount = 0;
      
      if ($scope.allAvailableMods) {
        $scope.allAvailableMods.forEach(function(mod) {
          if (mod.tagid && metadataCache[mod.tagid] && !$scope.hasRepoInfo(mod)) {
            const cached = metadataCache[mod.tagid];
            
            const cacheAge = Date.now() - (cached.cached_at || 0);
            if (cacheAge < 24 * 60 * 60 * 1000) {
              mod.download_count = cached.download_count;
              mod.rating_avg = cached.rating_avg;
              mod.filesize = cached.filesize;
              appliedCount++;
            }
          }
        });
      }
      
      if (appliedCount > 0) {
        console.log(`Applied cached repository metadata to ${appliedCount} mods`);
      }
    } catch (error) {
      console.error('Failed to load repository metadata cache:', error);
    }
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
    
    if ($scope.createPackActiveTab === 'selected') {
      $scope.filterSelectedMods();
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
    $scope.editingPack = null;
    
    $scope.requestedSelectedMods = [];
    $scope.filteredSelectedMods = [];
  };
  
  $scope.goToCreatePackPage = function(pageNumber) {
    if (pageNumber >= 1 && pageNumber <= $scope.createPackTotalPages) {
      $scope.createPackCurrentPage = pageNumber;
      
      setTimeout(function() {
        const displayedMods = $scope.getPagedMods();
        $scope.fetchRepositoryMetadataForDisplayed(displayedMods, 'Local Mods pagination');
      }, 100);
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
    $scope.createPackModsPerPage = parseInt($scope.createPackModsPerPage);
    
    $scope.createPackTotalPages = Math.ceil($scope.filteredMods.length / $scope.createPackModsPerPage);
    
    if ($scope.createPackCurrentPage > $scope.createPackTotalPages) {
      $scope.createPackCurrentPage = 1;
    }
    
    if ($scope.createPackCurrentPage < 1) {
      $scope.createPackCurrentPage = 1;
    }
    
    setTimeout(function() {
      const displayedMods = $scope.getPagedMods();
      $scope.fetchRepositoryMetadataForDisplayed(displayedMods, 'Local Mods page size change');
    }, 100);
  };
  
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
    
    $scope.requestSelectedModDetails();
  };
  
  $scope.requestSelectedModDetails = function() {
    const selectedMods = Object.values($scope.createPackForm.selectedMods);
    const repoModsNeedingDetails = [];
    
    selectedMods.forEach(function(mod) {
      if (mod.tagid && !mod.filesize_display && !mod.downTxt && !mod.tag_line) {
        repoModsNeedingDetails.push(mod.tagid);
      }
    });
    
    if (repoModsNeedingDetails.length > 0) {
      $scope.requestedSelectedMods = [...repoModsNeedingDetails];
      
      const luaTable = '{' + repoModsNeedingDetails.map(modId => `'${modId}'`).join(',') + '}';
      bngApi.engineLua(`extensions.repoManager.requestMultipleMods(${luaTable})`);
    } else {
      $scope.requestedSelectedMods = [];
    }
  };
  
  $scope.updateSelectedModsPagination = function() {
    $scope.selectedModsPerPage = parseInt($scope.selectedModsPerPage);
    
    $scope.selectedModsTotalPages = Math.ceil($scope.filteredSelectedMods.length / $scope.selectedModsPerPage);
    
    if ($scope.selectedModsCurrentPage > $scope.selectedModsTotalPages) {
      $scope.selectedModsCurrentPage = 1;
    }
    
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
      $scope.filterSelectedMods();
    }
  };
  
  $scope.clearAllSelectedMods = function() {
    if (confirm('Are you sure you want to clear all selected mods?')) {
      $scope.createPackForm.selectedMods = {};
      $scope.filterSelectedMods();
    }
  };
  
  $scope.isCustomPack = function(pack) {
    const section = $scope.modSections.find(s => s.isCustom);
    return section && section.packs.includes(pack) && !pack.isCreatePack;
  };
  
  $scope.editCustomPack = function(pack) {
    if (!$scope.isCustomPack(pack)) return;

    $scope.editingPack = pack;
    $scope.showCreatePackModal = true;
    $scope.loadAllAvailableMods();
    
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
        
        let localIcon = null;
        if ($scope.allAvailableMods && modData.tagid) {
          const localMod = $scope.allAvailableMods.find(mod => mod.tagid === modData.tagid);
          if (localMod && localMod.iconPath) {
            localIcon = localMod.iconPath;
          }
        }
        
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

  $scope.$on('ModReceived', function(event, data) {
    $scope.$apply(function() {
      if (data && data.data && data.data.tagid && $scope.requestedSelectedMods.includes(data.data.tagid)) {
        const modData = data.data;
        
        if (modData.path && !modData.icon) {
          modData.icon = `https://api.beamng.com/s1/v4/download/mods/${modData.path}icon.jpg`;
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
        
        const modId = modData.tagid;
        if ($scope.createPackForm.selectedMods[modId]) {
          if ($scope.createPackForm.selectedMods[modId].isLoading) {
            $scope.createPackForm.selectedMods[modId] = modData;
            console.log('Updated loading placeholder with real data:', modData.title || modData.name || modId);
          } else {
            Object.assign($scope.createPackForm.selectedMods[modId], modData);
          }
        } else {
          $scope.createPackForm.selectedMods[modId] = modData;
          console.log('Added missing pack mod to selection:', modData.title || modData.name || modId);
        }
        
        const index = $scope.requestedSelectedMods.indexOf(modData.tagid);
        if (index > -1) {
          $scope.requestedSelectedMods.splice(index, 1);
        }
        
        if ($scope.requestedSelectedMods.length === 0) {
          console.log('All missing pack mods have been loaded successfully');
        }
        
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
      }
    });
  });

  $scope.$on('ModReceived', function(event, data) {
    $scope.$apply(function() {
      if (data && data.data && data.data.tagid && $scope.requestedRepoMetadata.includes(data.data.tagid)) {
        const modData = data.data;
        
        if ($scope.allAvailableMods) {
          const localMod = $scope.allAvailableMods.find(function(mod) {
            return mod.tagid === modData.tagid;
          });
          
          if (localMod) {
            localMod.download_count = modData.download_count;
            localMod.rating_avg = modData.rating_avg;
            localMod.filesize = modData.filesize;
            localMod.tag_line = modData.tag_line;
            
            console.log(`Updated repository metadata for ${localMod.title || localMod.name || modData.tagid}`);
          }
        }
        
        const index = $scope.requestedRepoMetadata.indexOf(modData.tagid);
        if (index > -1) {
          $scope.requestedRepoMetadata.splice(index, 1);
        }
      }
    });
  });

  $scope.loadEnabledState();
  $scope.loadExpandedState();
  $scope.loadDependencies();
  
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
  
  const mainInterval = setInterval(function() {
    if ($scope.loading && ($scope.dependencies && $scope.dependencies.length > 0)) {
      $scope.$apply(function() {
        $scope.loading = false;
      });
    }
  }, 2000);
  $scope._intervals.push(mainInterval);
  
  const statusInterval = setInterval(function() {
    $scope.requestSubscriptionStatus();
  }, 5000);
  $scope._intervals.push(statusInterval);
  
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