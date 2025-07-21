'use strict'

angular.module('beamng.stuff')
.controller('RepoManagerController', ['$scope', '$state', '$http', function($scope, $state, $http) {
  $scope.message = 'Welcome to Repo Manager!';
  $scope.dependencies = [];
  $scope.loading = true;
  $scope.enabledPacks = {}; // Track enabled/disabled state
  $scope.packProgress = {}; // Track download progress for each pack
  $scope.packStatuses = {}; // Track active mod counts for each pack
  
  // Load enabled packs state from localStorage or default to all enabled
  $scope.loadEnabledState = function() {
    const saved = localStorage.getItem('repoManager_enabledPacks');
    if (saved) {
      $scope.enabledPacks = JSON.parse(saved);
    }
  };
  
  // Save enabled packs state to localStorage
  $scope.saveEnabledState = function() {
    localStorage.setItem('repoManager_enabledPacks', JSON.stringify($scope.enabledPacks));
  };
  
  // Load dependencies using the Lua module
  $scope.loadDependencies = function() {
    bngApi.engineLua('extensions.repoManager.loadDependencies()');
  };
  
  // Handle download progress updates
  $scope.$on('downloadStatesChanged', function(event, progressData) {
    $scope.$apply(function() {
      // Update progress for each pack based on mod downloads
      $scope.dependencies.forEach(function(pack) {
        if (!$scope.packProgress[pack.id] || !$scope.packProgress[pack.id].downloading) {
          return; // Skip if pack isn't currently downloading
        }
        
        // Only update download-specific progress if we're not using direct status scanning
        let packDownloading = false;
        
        pack.modIds.forEach(function(modId) {
          // Find progress for this mod - check multiple ways
          const modProgress = progressData.find(p => 
            (p.filename && p.filename.includes(modId)) ||
            (p.id && p.id === modId) ||
            (p.uri && p.uri.includes(modId))
          );
          
          if (modProgress && modProgress.state === 'working') {
            packDownloading = true;
          }
        });
        
        // If we have active downloads, let the regular download progress handle it
        // Otherwise, rely on our direct status scanning
        if (!packDownloading) {
          $scope.refreshPackProgress(pack);
        }
      });
    });
  });
  
  // Handle update queue state changes
  $scope.$on('UpdateQueueState', function(event, data) {
    $scope.$apply(function() {
      // Only handle completion notifications, let direct scanning handle progress
      $scope.dependencies.forEach(function(pack) {
        if (!$scope.packProgress[pack.id] || !$scope.packProgress[pack.id].downloading) {
          return;
        }
        
        // Check if any mods completed and refresh status
        if (data.doneList && data.doneList.length > 0) {
          let packHasCompletedMods = false;
          data.doneList.forEach(function(item) {
            if (pack.modIds.includes(item.id)) {
              packHasCompletedMods = true;
            }
          });
          
          if (packHasCompletedMods) {
            $scope.refreshPackProgress(pack);
          }
        }
      });
    });
  });
  
  // Handle individual mod download completion
  $scope.$on('ModDownloaded', function(event, data) {
    $scope.$apply(function() {
      // Find packs that contain this mod and refresh their status
      $scope.dependencies.forEach(function(pack) {
        if (pack.modIds.includes(data.modID) && $scope.packProgress[pack.id]) {
          $scope.refreshPackProgress(pack);
        }
      });
    });
  });
  
  // Handle update finished
  $scope.$on('UpdateFinished', function(event) {
    $scope.$apply(function() {
      // Refresh status for all downloading packs
      $scope.dependencies.forEach(function(pack) {
        if ($scope.packProgress[pack.id] && $scope.packProgress[pack.id].downloading) {
          $scope.refreshPackProgress(pack);
        }
      });
    });
  });
  
  // Handle mod status changes
  $scope.$on('RepoModChangeStatus', function(event, modData) {
    $scope.$apply(function() {
      // Find packs that contain this mod and refresh their status
      $scope.dependencies.forEach(function(pack) {
        if (pack.modIds.includes(modData.id) && $scope.packProgress[pack.id]) {
          $scope.refreshPackProgress(pack);
        }
      });
    });
  });
  
  // Handle pack mod activation (for locally available mods)
  $scope.$on('PackProgressUpdate', function(event, data) {
    $scope.$apply(function() {
      // Find the pack and update progress
      $scope.dependencies.forEach(function(pack) {
        if (pack.packName === data.packName && $scope.packProgress[pack.id]) {
          // Update with actual current status
          $scope.packProgress[pack.id].completedMods = data.active;
          $scope.packProgress[pack.id].progress = data.percentage;
          
          console.log('Pack progress updated:', data.packName, data.active + '/' + data.total, '(' + data.percentage + '%)');
          
          // Check if pack is complete
          if (data.active >= data.total) {
            $scope.packProgress[pack.id].downloading = false;
            $scope.packProgress[pack.id].progress = 100;
            
            console.log('Pack completed:', pack.packName);
            
            // Clear progress after delay
            setTimeout(function() {
              $scope.$apply(function() {
                delete $scope.packProgress[pack.id];
              });
            }, 5000);
          }
        }
      });
    });
  });
  
  // Function to refresh progress for a specific pack
  $scope.refreshPackProgress = function(pack) {
    if (pack.packName) {
      bngApi.engineLua(`
        local progress = extensions.repoManager.getPackProgressUpdate('${pack.packName}')
        guihooks.trigger('PackProgressUpdate', progress)
      `);
    }
  };
  
  // Function to refresh all pack progress
  $scope.refreshAllPackProgress = function() {
    $scope.dependencies.forEach(function(pack) {
      if ($scope.packProgress[pack.id] && $scope.packProgress[pack.id].downloading) {
        $scope.refreshPackProgress(pack);
      }
    });
  };
  
  // Periodically refresh progress for downloading packs
  setInterval(function() {
    $scope.refreshAllPackProgress();
  }, 2000); // Check every 2 seconds
  
  // Periodically refresh pack statuses to catch any missed changes
  setInterval(function() {
    $scope.refreshAllPackStatuses();
  }, 10000); // Check every 10 seconds
  
  // Handle loaded dependencies
  $scope.$on('DependenciesLoaded', function(event, data) {
    $scope.$apply(function() {
      $scope.dependencies = Object.keys(data).map(function(dirPath) {
        const packData = data[dirPath];
        const dirName = dirPath.replace('/dependencies/', '');
        
        const pack = {
          id: dirName,
          packName: packData.packName, // Use the packName from Lua
          dirPath: dirPath,
          name: packData.info.name || dirName,
          description: packData.info.description || 'No description available',
          preview: packData.info.preview || 'image.png',
          imagePath: packData.info.previewPath || (dirPath + '/image.png'),
          modIds: packData.requiredMods.modIds || [],
          count: packData.requiredMods.modIds ? packData.requiredMods.modIds.length : 0
        };
        
        // Set default enabled state if not previously set
        if ($scope.enabledPacks[pack.id] === undefined) {
          $scope.enabledPacks[pack.id] = true;
        }
        
        return pack;
      });
      
      $scope.loading = false;
      $scope.saveEnabledState();
    });
  });
  
  // Handle pack status information
  $scope.$on('PackStatusesLoaded', function(event, data) {
    $scope.$apply(function() {
      $scope.packStatuses = data;
      console.log('Pack statuses loaded:', data);
      
      // Update pack enabled state based on whether ALL mods are active
      Object.keys(data).forEach(function(packName) {
        const status = data[packName];
        const pack = $scope.dependencies.find(p => p.packName === packName);
        if (pack) {
          // Pack is enabled only if ALL mods are active
          if (status.isPackFullyActive) {
            $scope.enabledPacks[pack.id] = true;
          } else {
            $scope.enabledPacks[pack.id] = false;
          }
        }
      });
      
      $scope.saveEnabledState();
    });
  });
  
  // Handle pack installation events
  $scope.$on('PackInstalled', function(event, data) {
    $scope.$apply(function() {
      console.log('Pack installed:', data.packId, 'with', data.modCount, 'mods');
    });
  });
  
  // Handle pack uninstallation events
  $scope.$on('PackUninstalled', function(event, data) {
    $scope.$apply(function() {
      console.log('Pack uninstalled:', data.packId, 'with', data.modCount, 'mods');
    });
  });
  
  $scope.goBack = function() {
    $state.go('menu.mainmenu');
  };
  
  $scope.togglePack = function(pack) {
    // Don't allow toggling while downloading
    if ($scope.packProgress[pack.id] && $scope.packProgress[pack.id].downloading) {
      return;
    }
    
    $scope.enabledPacks[pack.id] = !$scope.enabledPacks[pack.id];
    $scope.saveEnabledState();
    
    if ($scope.enabledPacks[pack.id]) {
      // Pack enabled - get initial status from Lua
      bngApi.engineLua(`extensions.repoManager.getPackStatus('${pack.packName}')`, function(status) {
        $scope.$apply(function() {
          $scope.packProgress[pack.id] = {
            downloading: true,
            progress: status.percentage || 0,
            completedMods: status.active || 0,
            totalMods: status.total || pack.modIds.length
          };
        });
      });
      
      bngApi.engineLua(`extensions.requiredMods.subscribeToPack('${pack.packName}')`);
    } else {
      // Pack disabled - use deactivatePack
      bngApi.engineLua(`extensions.requiredMods.deactivatePack('${pack.packName}')`);
    }
    
    // Refresh pack statuses after a delay to allow operations to complete
    setTimeout(function() {
      $scope.refreshAllPackStatuses();
    }, 2000);
  };
  
  // Function to refresh all pack statuses
  $scope.refreshAllPackStatuses = function() {
    console.log('Refreshing all pack statuses...');
    bngApi.engineLua('extensions.repoManager.checkAllPackStatuses()', function(data) {
      $scope.$apply(function() {
        if (data) {
          $scope.packStatuses = data;
          console.log('Pack statuses refreshed:', data);
        }
      });
    });
  };
  
  $scope.installCollection = function(pack) {
    // Install specific pack using subscribeToPack
    if (pack.packName) {
      bngApi.engineLua(`extensions.requiredMods.subscribeToPack('${pack.packName}')`);
    }
  };
  
  $scope.uninstallCollection = function(pack) {
    // Uninstall specific pack using deactivatePack
    if (pack.packName) {
      bngApi.engineLua(`extensions.requiredMods.deactivatePack('${pack.packName}')`);
    }
  };
  
  $scope.viewCollection = function(pack) {
    // Navigate to repository with filter for this pack
    $state.go('menu.mods.repository', {}, {
      reload: true
    });
  };
  
  $scope.installAllPacks = function() {
    // Install all packs using subscribeToAllMods
    bngApi.engineLua('extensions.requiredMods.subscribeToAllMods()');
    
    // Update all packs to enabled state
    $scope.dependencies.forEach(function(pack) {
      $scope.enabledPacks[pack.id] = true;
    });
    $scope.saveEnabledState();
    
    // Refresh statuses after delay
    setTimeout(function() {
      $scope.refreshAllPackStatuses();
    }, 3000);
  };
  
  $scope.uninstallAllPacks = function() {
    // Uninstall all packs using disableAllMods
    bngApi.engineLua('extensions.requiredMods.disableAllMods()');
    
    // Update all packs to disabled state
    $scope.dependencies.forEach(function(pack) {
      $scope.enabledPacks[pack.id] = false;
    });
    $scope.saveEnabledState();
    
    // Refresh statuses after delay
    setTimeout(function() {
      $scope.refreshAllPackStatuses();
    }, 3000);
  };
  
  $scope.getPackDetails = function(packId) {
    // Get detailed information about a pack
    const pack = $scope.dependencies.find(p => p.id === packId);
    if (pack) {
      console.log('Pack details:', pack);
      // Show the details modal
      $scope.showPackDetails(pack);
    }
  };
  
  // Pack details modal functionality
  $scope.selectedPack = null;
  $scope.packModDetails = [];
  $scope.loadingPackDetails = false;
  $scope.showDetailsModal = false;
  $scope.currentPage = 1;
  $scope.modsPerPage = 9;
  $scope.totalPages = 1;
  $scope.requestedMods = []; // Track which mods we're waiting for
  
  // Listen for mod details responses (same as repository UI)
  $scope.$on('ModReceived', function(event, data) {
    $scope.$apply(function() {
      if (data && data.data && $scope.requestedMods.includes(data.data.tagid)) {
        console.log('Received mod data for:', data.data.title || data.data.tagid);
        console.log('Available mod fields:', Object.keys(data.data));
        console.log('Author field:', data.data.author, 'Creator field:', data.data.creator, 'Username field:', data.data.username);
        
        const modData = data.data;
        // Format the mod data similar to repository
        
        // Use local icon path if this is a local mod and icon exists
        if (modData.isLocal && modData.localIconPath) {
          modData.icon = modData.localIconPath;
          console.log('Using local icon (relative):', modData.localIconPath);
          if (modData.localIconPathAlt) {
            console.log('Alternative path available:', modData.localIconPathAlt);
          }
        } else if (modData.path) {
          // Use online icon for mods with path data
          modData.icon = `https://api.beamng.com/s1/v4/download/mods/${modData.path}icon.jpg`;
          console.log('Using online icon for:', modData.tagid);
        } else {
          // No icon available, will use HTML fallback
          modData.icon = null;
          console.log('No icon available for:', modData.tagid);
        }
        
        modData.downTxt = modData.download_count > 1000 ? 
          (modData.download_count / 1000).toFixed(0) + "K" : 
          modData.download_count;
        modData.rating_avg = parseFloat(modData.rating_avg || 0).toFixed(1);
        modData.filesize_display = $scope.formatFileSize(modData.filesize);
        
        // Ensure author field is available - try multiple possible field names
        if (!modData.author && modData.creator) {
          modData.author = modData.creator;
        } else if (!modData.author && modData.username) {
          modData.author = modData.username;
        } else if (!modData.author && modData.user_name) {
          modData.author = modData.user_name;
        }
        
        // Log subscription status for debugging
        console.log('Mod subscription status:', modData.tagid, 'subscribed:', modData.sub, 'active:', modData.subscribed);
        
        $scope.packModDetails.push(modData);
        console.log('Added mod to details, now have:', $scope.packModDetails.length);
        
        // Remove from requested list
        const index = $scope.requestedMods.indexOf(data.data.tagid);
        if (index > -1) {
          $scope.requestedMods.splice(index, 1);
        }
        
        $scope.loadedModsCount++;
        
        // Check if we've loaded all mods for this page
        if ($scope.requestedMods.length === 0) {
          $scope.loadingPackDetails = false;
          console.log('Finished loading page', $scope.currentPage, 'with', $scope.packModDetails.length, 'mods');
        }
      }
    });
  });
  
  $scope.showPackDetails = function(pack) {
    $scope.selectedPack = pack;
    $scope.packModDetails = [];
    $scope.loadingPackDetails = true;
    $scope.showDetailsModal = true;
    $scope.currentPage = 1;
    $scope.totalPages = Math.ceil(pack.modIds.length / $scope.modsPerPage);
    $scope.requestedMods = [];
    
    console.log('Loading pack details for:', pack.name, 'Total mods:', pack.modIds.length, 'Pages:', $scope.totalPages);
    
    // Load first page
    $scope.loadModsPage(1);
  };
  
  $scope.loadModsPage = function(pageNumber) {
    $scope.loadingPackDetails = true;
    $scope.packModDetails = [];
    $scope.currentPage = pageNumber;
    $scope.loadedModsCount = 0;
    $scope.requestedMods = [];
    
    // Calculate which mods to load for this page
    const startIndex = (pageNumber - 1) * $scope.modsPerPage;
    const endIndex = Math.min(startIndex + $scope.modsPerPage, $scope.selectedPack.modIds.length);
    const modsToLoad = $scope.selectedPack.modIds.slice(startIndex, endIndex);
    
    console.log(`Loading page ${pageNumber}: mods ${startIndex + 1}-${endIndex} (${modsToLoad.length} mods)`);
    
    // Track which mods we're requesting
    $scope.requestedMods = [...modsToLoad];
    
    // Use our new queued request system that adds delays between calls
    console.log('Using queued mod request system with delays');
    
    // Convert JavaScript array to Lua table syntax
    const luaTable = '{' + modsToLoad.map(modId => `'${modId}'`).join(',') + '}';
    console.log('Lua table:', luaTable);
    
    bngApi.engineLua(`extensions.repoManager.requestMultipleMods(${luaTable})`, function(result) {
      console.log('Queued mod requests initiated');
    });
    
    // Set a longer timeout since we're using delays
    setTimeout(function() {
      $scope.$apply(function() {
        if ($scope.loadingPackDetails && $scope.requestedMods.length > 0) {
          console.log('Timeout reached, some mods did not respond:', $scope.requestedMods);
          $scope.loadingPackDetails = false;
        }
      });
    }, 20000); // 20 second timeout for queued requests
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
    // Navigate to the repository with this specific mod
    bngApi.engineLua(`guihooks.trigger('ChangeState', {state = 'menu.mods.details', params = {modId = '${mod.tagid}'}})`);
  };
  
  $scope.subscribeToMod = function(mod) {
    console.log('Subscribing to mod:', mod.tagid);
    bngApi.engineLua(`extensions.core_repository.modSubscribe('${mod.tagid}')`);
    mod.sub = true;
    mod.subscribed = true;
    mod.pending = true;
  };
  
  $scope.unsubscribeFromMod = function(mod) {
    console.log('Unsubscribing from mod:', mod.tagid);
    bngApi.engineLua(`extensions.core_repository.modUnsubscribe('${mod.tagid}')`);
    mod.sub = false;
    mod.subscribed = false;
  };
  
  // Function to get cache information
  $scope.getCacheInfo = function() {
    bngApi.engineLua('extensions.repoManager.getCacheInfo()', function(data) {
      $scope.$apply(function() {
        if (data) {
          console.log('Cache Info:', data);
          console.log(`Cached mods: ${data.totalCached}, Expired: ${data.expiredEntries}, Expiry: ${data.expiryTime}s`);
        }
      });
    });
  };
  
  // Function to clear cache
  $scope.clearCache = function() {
    bngApi.engineLua('extensions.repoManager.clearModCache()');
    console.log('Mod cache cleared');
  };
  
  // Load enabled state and dependencies on controller initialization
  $scope.loadEnabledState();
  $scope.loadDependencies();
  
  // Show cache info on startup
  setTimeout(function() {
    $scope.getCacheInfo();
  }, 3000);
}])

// Add range filter for pagination
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
              icon: '/ui/modModules/repoManager/icons/repoManagerIcon.svg',
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