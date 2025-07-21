'use strict'

angular.module('beamng.stuff')
.controller('RepoManagerController', ['$scope', '$state', '$http', function($scope, $state, $http) {
  $scope.message = 'Welcome to Repo Manager!';
  $scope.dependencies = [];
  $scope.loading = true;
  $scope.enabledPacks = {}; // Track enabled/disabled state
  $scope.packProgress = {}; // Track download progress for each pack
  $scope.packStatuses = {}; // Track active mod counts for each pack
  $scope.downloadedMods = {}; // Track downloaded but not yet active mods by pack
  
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
  
  // Load progress state from localStorage
  $scope.loadProgressState = function() {
    const savedProgress = localStorage.getItem('repoManager_packProgress');
    const savedDownloaded = localStorage.getItem('repoManager_downloadedMods');
    
    if (savedProgress) {
      $scope.packProgress = JSON.parse(savedProgress);
      console.log('Restored pack progress from localStorage:', $scope.packProgress);
    }
    
    if (savedDownloaded) {
      $scope.downloadedMods = JSON.parse(savedDownloaded);
      console.log('Restored downloaded mods from localStorage:', $scope.downloadedMods);
    }
  };
  
  // Save progress state to localStorage
  $scope.saveProgressState = function() {
    localStorage.setItem('repoManager_packProgress', JSON.stringify($scope.packProgress));
    localStorage.setItem('repoManager_downloadedMods', JSON.stringify($scope.downloadedMods));
  };
  
  // Load dependencies using the Lua module
  $scope.loadDependencies = function() {
    bngApi.engineLua('extensions.repoManager.loadDependencies()');
  };
  
  // Query Lua backend for current download/subscription status
  $scope.syncWithBackendState = function() {
    console.log('Syncing progress with backend state...');
    
    // Get subscription status from requiredMods extension
    bngApi.engineLua('extensions.requiredMods.getSubscriptionStatus()', function(subStatus) {
      if (subStatus && (subStatus.isSubscribing || subStatus.active > 0 || subStatus.queued > 0)) {
        console.log('Backend subscription status:', subStatus);
        
        // If there are active subscriptions, we need to restore progress tracking
        Object.keys($scope.packProgress).forEach(function(packId) {
          const progress = $scope.packProgress[packId];
          if (progress && progress.downloading) {
            console.log('Restoring progress tracking for pack:', packId);
            
            // Find the pack data
            const pack = $scope.dependencies.find(p => p.id === packId);
            if (pack) {
              // Get current pack status from backend
              bngApi.engineLua(`extensions.repoManager.getPackStatus('${pack.packName}')`, function(status) {
                $scope.$apply(function() {
                  if ($scope.packProgress[packId]) {
                    // Update with current backend status
                    $scope.packProgress[packId].completedMods = status.active || 0;
                    $scope.packProgress[packId].totalMods = status.total || pack.modIds.length;
                    
                    // Check if pack is actually complete now
                    if (status.active >= status.total && status.total > 0) {
                      $scope.packProgress[packId].downloading = false;
                      $scope.packProgress[packId].progress = 100;
                      $scope.packProgress[packId].activeDownloads = 0;
                      
                      // Clear downloaded mods for this pack
                      if ($scope.downloadedMods[packId]) {
                        delete $scope.downloadedMods[packId];
                      }
                      
                      console.log('Pack completed while menu was closed:', pack.packName);
                      
                      // Clear progress after delay
                      setTimeout(function() {
                        $scope.$apply(function() {
                          if ($scope.packProgress[packId] && !$scope.packProgress[packId].downloading) {
                            delete $scope.packProgress[packId];
                            $scope.saveProgressState();
                          }
                        });
                      }, 3000);
                    } else {
                      // Still in progress, calculate current progress
                      const downloadedPending = $scope.downloadedMods[packId] ? $scope.downloadedMods[packId].length : 0;
                      const progressValue = Math.floor(((status.active * 100) + (downloadedPending * 95)) / status.total);
                      $scope.packProgress[packId].progress = Math.min(progressValue, 100);
                      
                      console.log('Restored progress for pack:', pack.packName, 
                                 'Active:', status.active, 'Pending:', downloadedPending, 
                                 'Progress:', $scope.packProgress[packId].progress + '%');
                    }
                    
                    $scope.saveProgressState();
                  }
                });
              });
            }
          }
        });
      } else {
        console.log('No active subscriptions detected in backend');
        
        // Clear any stale progress data if backend shows no activity
        let hasChanges = false;
        Object.keys($scope.packProgress).forEach(function(packId) {
          if ($scope.packProgress[packId] && $scope.packProgress[packId].downloading) {
            console.log('Clearing stale progress for pack:', packId);
            delete $scope.packProgress[packId];
            if ($scope.downloadedMods[packId]) {
              delete $scope.downloadedMods[packId];
            }
            hasChanges = true;
          }
        });
        
        if (hasChanges) {
          $scope.saveProgressState();
        }
      }
    });
  };
  
  // Handle download progress updates
  $scope.$on('downloadStatesChanged', function(event, progressData) {
    $scope.$apply(function() {
      console.log('Download states changed, checking pack progress...');
      
      // Update progress for each pack based on mod downloads
      $scope.dependencies.forEach(function(pack) {
        if (!$scope.packProgress[pack.id] || !$scope.packProgress[pack.id].downloading) {
          return; // Skip if pack isn't currently downloading
        }
        
        // Calculate weighted progress including partial downloads and pending activations
        let totalProgress = 0;
        let activeDownloads = 0;
        let downloadProgress = {};
        
        // Get current completed mods count from our existing data
        const currentCompletedMods = $scope.packProgress[pack.id].completedMods || 0;
        
        // Initialize downloaded mods tracking for this pack if not exists
        if (!$scope.downloadedMods[pack.id]) {
          $scope.downloadedMods[pack.id] = [];
        }
        
        pack.modIds.forEach(function(modId) {
          // Find download progress for this mod
          const modProgress = progressData.find(p => 
            (p.filename && p.filename.includes(modId)) ||
            (p.id && p.id === modId) ||
            (p.uri && p.uri.includes(modId))
          );
          
          if (modProgress && modProgress.state === 'working') {
            // Calculate download percentage for this mod
            let modPercentage = 0;
            if (modProgress.dltotal > 0) {
              modPercentage = Math.floor((modProgress.dlnow / modProgress.dltotal) * 100);
            }
            downloadProgress[modId] = modPercentage;
            activeDownloads++;
            console.log('Mod', modId, 'downloading:', modPercentage + '%', 
                       '(' + Math.floor(modProgress.dlnow/1024) + 'KB/' + Math.floor(modProgress.dltotal/1024) + 'KB)');
          }
        });
        
        // Calculate progress: completed(100%) + downloaded pending(95%) + downloading(actual%) + not started(0%)
        const completedModsProgress = currentCompletedMods * 100;
        const downloadedPendingProgress = $scope.downloadedMods[pack.id].length * 95; // 95% for downloaded but not active
        const downloadingModsProgress = Object.values(downloadProgress).reduce((sum, percent) => sum + percent, 0);
        
        totalProgress = completedModsProgress + downloadedPendingProgress + downloadingModsProgress;
        let overallProgress = Math.floor(totalProgress / pack.modIds.length);
        
        // Ensure progress doesn't exceed 100% and is at least the completion percentage
        const minProgress = Math.floor((currentCompletedMods / pack.modIds.length) * 100);
        overallProgress = Math.max(minProgress, Math.min(overallProgress, 100));
        
        // Log detailed progress breakdown
        if (activeDownloads > 0 || $scope.downloadedMods[pack.id].length > 0) {
          console.log('Pack', pack.packName, 'detailed progress:', 
                     'Active:', currentCompletedMods,
                     'Downloaded pending:', $scope.downloadedMods[pack.id].length,
                     'Downloading:', activeDownloads,
                     'Total progress:', overallProgress + '%');
        }
        
        // Update pack progress with weighted calculation only if we have active downloads
        if (activeDownloads > 0) {
          $scope.packProgress[pack.id].progress = overallProgress;
          $scope.packProgress[pack.id].activeDownloads = activeDownloads;
          $scope.packProgress[pack.id].downloadDetails = downloadProgress;
          
          console.log('Pack', pack.packName, 'weighted progress:', overallProgress + '%', 
                     '(completed:', currentCompletedMods + ', downloading:', activeDownloads + ')');
          
          // Save progress state
          $scope.saveProgressState();
        }
        
        // Refresh pack progress to get accurate completion status
        $scope.refreshPackProgress(pack);
      });
    });
  });
  
  // Handle update queue state changes
  $scope.$on('UpdateQueueState', function(event, data) {
    $scope.$apply(function() {
      // Handle completion notifications and update progress immediately
      $scope.dependencies.forEach(function(pack) {
        if (!$scope.packProgress[pack.id] || !$scope.packProgress[pack.id].downloading) {
          return;
        }
        
        // Check if any mods in this pack completed
        if (data.doneList && data.doneList.length > 0) {
          let packCompletedMods = 0;
          
          data.doneList.forEach(function(item) {
            if (pack.modIds.includes(item.id)) {
              packCompletedMods++;
              console.log('Mod completed via UpdateQueueState:', item.id);
            }
          });
          
          if (packCompletedMods > 0) {
            // Increment completed mods count
            $scope.packProgress[pack.id].completedMods = ($scope.packProgress[pack.id].completedMods || 0) + packCompletedMods;
            
            // Decrease active downloads
            if ($scope.packProgress[pack.id].activeDownloads >= packCompletedMods) {
              $scope.packProgress[pack.id].activeDownloads -= packCompletedMods;
            } else {
              $scope.packProgress[pack.id].activeDownloads = 0;
            }
            
            // Recalculate progress
            const completedMods = $scope.packProgress[pack.id].completedMods;
            const totalMods = $scope.packProgress[pack.id].totalMods || pack.modIds.length;
            const completionPercentage = Math.floor((completedMods / totalMods) * 100);
            
            // Update progress to at least the completion percentage
            $scope.packProgress[pack.id].progress = Math.max($scope.packProgress[pack.id].progress || 0, completionPercentage);
            
            console.log('Pack progress updated via UpdateQueueState:', pack.packName, 
                       completedMods + '/' + totalMods, '(' + $scope.packProgress[pack.id].progress + '%)');
            
            // Check if pack is now complete
            if (completedMods >= totalMods) {
              $scope.packProgress[pack.id].downloading = false;
              $scope.packProgress[pack.id].progress = 100;
              $scope.packProgress[pack.id].activeDownloads = 0;
              
              console.log('Pack completed via UpdateQueueState:', pack.packName);
              
              // Clear progress after delay
              setTimeout(function() {
                $scope.$apply(function() {
                  if ($scope.packProgress[pack.id] && !$scope.packProgress[pack.id].downloading) {
                    delete $scope.packProgress[pack.id];
                  }
                });
              }, 3000);
            }
            
            // Also refresh pack progress to sync with actual mod status
            $scope.refreshPackProgress(pack);
          }
        }
      });
    });
  });
  
  // Handle individual mod download completion
  $scope.$on('ModDownloaded', function(event, data) {
    $scope.$apply(function() {
      console.log('Mod download completed (pending activation):', data.modID);
      
      // Find packs that contain this mod and update their progress immediately
      $scope.dependencies.forEach(function(pack) {
        if (pack.modIds.includes(data.modID) && $scope.packProgress[pack.id]) {
          // Initialize downloaded mods tracking for this pack if not exists
          if (!$scope.downloadedMods[pack.id]) {
            $scope.downloadedMods[pack.id] = [];
          }
          
          // Add to downloaded but not yet active list (if not already there)
          if (!$scope.downloadedMods[pack.id].includes(data.modID)) {
            $scope.downloadedMods[pack.id].push(data.modID);
            console.log('Added mod to pending activation:', data.modID, 'Pack:', pack.packName);
          }
          
          // Remove this mod from active downloads if it was there
          if ($scope.packProgress[pack.id].downloadDetails && $scope.packProgress[pack.id].downloadDetails[data.modID]) {
            delete $scope.packProgress[pack.id].downloadDetails[data.modID];
          }
          
          // Decrement active downloads count
          if ($scope.packProgress[pack.id].activeDownloads > 0) {
            $scope.packProgress[pack.id].activeDownloads--;
          }
          
          // Recalculate progress including downloaded pending mods
          const completedMods = $scope.packProgress[pack.id].completedMods || 0;
          const downloadedPending = $scope.downloadedMods[pack.id].length;
          const totalMods = $scope.packProgress[pack.id].totalMods || pack.modIds.length;
          
          // Calculate progress: completed(100%) + downloaded pending(95%)
          const progressValue = Math.floor(((completedMods * 100) + (downloadedPending * 95)) / totalMods);
          $scope.packProgress[pack.id].progress = Math.min(progressValue, 100);
          
          console.log('Pack progress after download completion:', pack.packName, 
                     'Active:', completedMods, 'Pending:', downloadedPending, 
                     'Progress:', $scope.packProgress[pack.id].progress + '%');
          
          // Check if all mods are downloaded (either active or pending)
          if ((completedMods + downloadedPending) >= totalMods) {
            $scope.packProgress[pack.id].progress = 99; // Show 99% while waiting for final activation
            console.log('All mods downloaded, waiting for activation:', pack.packName);
          }
          
          // Save progress state after download completion
          $scope.saveProgressState();
          
          // Refresh pack progress from Lua to sync with actual mod status
          $scope.refreshPackProgress(pack);
        }
      });
    });
  });
  
  // Handle update finished
  $scope.$on('UpdateFinished', function(event) {
    $scope.$apply(function() {
      console.log('All downloads finished, finalizing pack progress...');
      
      // Finalize status for all downloading packs
      $scope.dependencies.forEach(function(pack) {
        if ($scope.packProgress[pack.id] && $scope.packProgress[pack.id].downloading) {
          // Get final pack status
          bngApi.engineLua(`extensions.repoManager.getPackStatus('${pack.packName}')`, function(status) {
            $scope.$apply(function() {
              if ($scope.packProgress[pack.id]) {
                $scope.packProgress[pack.id].completedMods = status.active || 0;
                $scope.packProgress[pack.id].totalMods = status.total || pack.modIds.length;
                $scope.packProgress[pack.id].progress = status.percentage || 0;
                $scope.packProgress[pack.id].activeDownloads = 0;
                
                // Mark as complete if all mods are active
                if (status.active >= status.total && status.total > 0) {
                  $scope.packProgress[pack.id].downloading = false;
                  $scope.packProgress[pack.id].progress = 100;
                  
                  console.log('Pack finalized as complete:', pack.packName);
                  
                  // Clear progress after delay
                  setTimeout(function() {
                    $scope.$apply(function() {
                      if ($scope.packProgress[pack.id] && !$scope.packProgress[pack.id].downloading) {
                        delete $scope.packProgress[pack.id];
                      }
                    });
                  }, 3000);
                } else {
                  // Still downloading or some mods failed
                  console.log('Pack partially complete:', pack.packName, status.active + '/' + status.total);
                }
              }
            });
          });
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
          // Initialize downloaded mods tracking for this pack if not exists
          if (!$scope.downloadedMods[pack.id]) {
            $scope.downloadedMods[pack.id] = [];
          }
          
          const previousActiveMods = $scope.packProgress[pack.id].completedMods || 0;
          const newActiveMods = data.active;
          
          // Update completed mods count
          $scope.packProgress[pack.id].completedMods = newActiveMods;
          $scope.packProgress[pack.id].totalMods = data.total;
          
          // If we have new active mods, check if any were in our pending list
          if (newActiveMods > previousActiveMods) {
            const newlyActivatedCount = newActiveMods - previousActiveMods;
            console.log('Detected', newlyActivatedCount, 'newly activated mods for pack:', pack.packName);
            
            // Remove newly activated mods from downloaded pending list
            // (We'll remove up to the count of newly activated mods)
            for (let i = 0; i < newlyActivatedCount && $scope.downloadedMods[pack.id].length > 0; i++) {
              const movedMod = $scope.downloadedMods[pack.id].shift(); // Remove first pending mod
              console.log('Moved mod from pending to active:', movedMod, 'Pack:', pack.packName);
            }
          }
          
          // Calculate progress including both active and pending mods
          const downloadedPending = $scope.downloadedMods[pack.id].length;
          const hasActiveDownloads = $scope.packProgress[pack.id].activeDownloads > 0;
          
          // Only update progress percentage if we don't have active downloads with better granular data
          if (!hasActiveDownloads) {
            // Calculate: active(100%) + pending(95%)
            const progressValue = Math.floor(((newActiveMods * 100) + (downloadedPending * 95)) / data.total);
            $scope.packProgress[pack.id].progress = Math.min(progressValue, 100);
          }
          
                      console.log('Pack status updated:', data.packName, 
                     'Active:', newActiveMods + '/' + data.total, 
                     'Pending:', downloadedPending,
                     'Progress:', $scope.packProgress[pack.id].progress + '%');
          
          // Save progress state after activation updates
          $scope.saveProgressState();
          
          // Check if pack is complete
          if (newActiveMods >= data.total && data.total > 0) {
            $scope.packProgress[pack.id].downloading = false;
            $scope.packProgress[pack.id].progress = 100;
            $scope.packProgress[pack.id].activeDownloads = 0;
            
            // Clear any remaining pending mods
            $scope.downloadedMods[pack.id] = [];
            
            console.log('Pack completed:', pack.packName);
            
            // Save completion state
            $scope.saveProgressState();
            
            // Clear progress after delay
            setTimeout(function() {
              $scope.$apply(function() {
                if ($scope.packProgress[pack.id] && !$scope.packProgress[pack.id].downloading) {
                  delete $scope.packProgress[pack.id];
                  delete $scope.downloadedMods[pack.id];
                  $scope.saveProgressState();
                }
              });
            }, 3000);
          } else if (data.total > 0) {
            // Keep downloading state if not complete
            $scope.packProgress[pack.id].downloading = true;
          }
        }
      });
    });
  });
  
  // Function to refresh progress for a specific pack
  $scope.refreshPackProgress = function(pack) {
    if (pack.packName && $scope.packProgress[pack.id]) {
      console.log('Refreshing progress for pack:', pack.packName);
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
    // Only refresh if we have downloading packs
    const hasDownloadingPacks = Object.keys($scope.packProgress).some(packId => 
      $scope.packProgress[packId] && $scope.packProgress[packId].downloading
    );
    
    if (hasDownloadingPacks) {
      console.log('Refreshing progress for downloading packs...');
      $scope.refreshAllPackProgress();
    }
  }, 1000); // Check every 1 second for more responsive updates
  
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
      // Pack enabled - initialize progress immediately, then get status and start subscription
      $scope.packProgress[pack.id] = {
        downloading: true,
        progress: 0,
        completedMods: 0,
        totalMods: pack.modIds.length
      };
      
      // Get initial status from Lua
      bngApi.engineLua(`extensions.repoManager.getPackStatus('${pack.packName}')`, function(status) {
        $scope.$apply(function() {
          if ($scope.packProgress[pack.id]) {
            $scope.packProgress[pack.id].progress = status.percentage || 0;
            $scope.packProgress[pack.id].completedMods = status.active || 0;
            $scope.packProgress[pack.id].totalMods = status.total || pack.modIds.length;
          }
        });
        
        // Start subscription after getting initial status
        bngApi.engineLua(`extensions.requiredMods.subscribeToPack('${pack.packName}')`);
      });
    } else {
      // Pack disabled - clear any progress and use deactivatePack
      if ($scope.packProgress[pack.id]) {
        delete $scope.packProgress[pack.id];
      }
      if ($scope.downloadedMods[pack.id]) {
        delete $scope.downloadedMods[pack.id];
      }
      
      // Save state after clearing
      $scope.saveProgressState();
      
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
      // Initialize progress tracking
      $scope.packProgress[pack.id] = {
        downloading: true,
        progress: 0,
        completedMods: 0,
        totalMods: pack.modIds.length
      };
      
      // Clear any previous downloaded mods state
      $scope.downloadedMods[pack.id] = [];
      
      // Save initial progress state
      $scope.saveProgressState();
      
      console.log('Progress initialized for pack:', pack.packName, 'Progress state:', $scope.packProgress[pack.id]);
      
      // Enable the pack in our state
      $scope.enabledPacks[pack.id] = true;
      $scope.saveEnabledState();
      
      bngApi.engineLua(`extensions.requiredMods.subscribeToPack('${pack.packName}')`);
    }
  };
  
  $scope.uninstallCollection = function(pack) {
    // Uninstall specific pack using deactivatePack
    if (pack.packName) {
      // Clear progress and downloaded mods state
      if ($scope.packProgress[pack.id]) {
        delete $scope.packProgress[pack.id];
      }
      if ($scope.downloadedMods[pack.id]) {
        delete $scope.downloadedMods[pack.id];
      }
      $scope.enabledPacks[pack.id] = false;
      $scope.saveEnabledState();
      $scope.saveProgressState();
      
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
    // Initialize progress tracking for all packs
    $scope.dependencies.forEach(function(pack) {
      $scope.packProgress[pack.id] = {
        downloading: true,
        progress: 0,
        completedMods: 0,
        totalMods: pack.modIds.length
      };
      $scope.downloadedMods[pack.id] = [];
      $scope.enabledPacks[pack.id] = true;
    });
    $scope.saveEnabledState();
    $scope.saveProgressState();
    
    // Install all packs using subscribeToAllMods
    bngApi.engineLua('extensions.requiredMods.subscribeToAllMods()');
    
    // Refresh statuses after delay
    setTimeout(function() {
      $scope.refreshAllPackStatuses();
    }, 3000);
  };
  
  $scope.uninstallAllPacks = function() {
    // Clear all progress and downloaded mods state
    $scope.packProgress = {};
    $scope.downloadedMods = {};
    
    // Update all packs to disabled state
    $scope.dependencies.forEach(function(pack) {
      $scope.enabledPacks[pack.id] = false;
    });
    $scope.saveEnabledState();
    $scope.saveProgressState();
    
    // Uninstall all packs using disableAllMods
    bngApi.engineLua('extensions.requiredMods.disableAllMods()');
    
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
  $scope.loadProgressState();
  $scope.loadDependencies();
  
  // Sync with backend state after dependencies are loaded
  $scope.$on('DependenciesLoaded', function(event, data) {
    // This event is already handled above, but we'll add sync here
    setTimeout(function() {
      $scope.syncWithBackendState();
    }, 1000); // Give dependencies time to load
  });
  
  // Show cache info on startup
  setTimeout(function() {
    $scope.getCacheInfo();
  }, 3000);
  
  // Debug function to check progress state
  $scope.debugProgress = function() {
    console.log('Current pack progress:', $scope.packProgress);
    console.log('Downloaded pending mods:', $scope.downloadedMods);
    console.log('Enabled packs:', $scope.enabledPacks);
    
    // Show saved state from localStorage
    const savedProgress = localStorage.getItem('repoManager_packProgress');
    const savedDownloaded = localStorage.getItem('repoManager_downloadedMods');
    console.log('Saved progress state:', savedProgress ? JSON.parse(savedProgress) : 'None');
    console.log('Saved downloaded state:', savedDownloaded ? JSON.parse(savedDownloaded) : 'None');
    
    const downloadingPacks = Object.keys($scope.packProgress).filter(packId => 
      $scope.packProgress[packId] && $scope.packProgress[packId].downloading
    );
    console.log('Downloading packs:', downloadingPacks);
    
    // Show detailed breakdown for each downloading pack
    downloadingPacks.forEach(packId => {
      const progress = $scope.packProgress[packId];
      const pending = $scope.downloadedMods[packId] || [];
      console.log(`Pack ${packId}: Active: ${progress.completedMods}, Pending: ${pending.length}, Downloading: ${progress.activeDownloads}, Progress: ${progress.progress}%`);
    });
  };
  
  // Add debug function to window for console access
  window.debugRepoProgress = $scope.debugProgress;
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