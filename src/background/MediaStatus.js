// Focused worker methods; composed onto SeerrAPI by background.js.
(function (root) {
  root.MediaStatus = {
    formatMediaStatus(mediaDetails, mediaType) {
      if (!mediaDetails) {
        return {
          status: 'available',
          message: 'Ready to request',
          buttonText: 'Request on Seerr',
          buttonClass: 'request'
        };
      }

      this.log('📊 [Background] Raw mediaDetails for status formatting:');
      this.log('📊 [Background] mediaDetails.status:', mediaDetails.status);
      this.log('📊 [Background] mediaDetails.media:', mediaDetails.media ? {
        status: mediaDetails.media.status,
        tmdbId: mediaDetails.media.tmdbId,
        mediaUrl: mediaDetails.media.mediaUrl ? '[HAS_URL]' : null,
        seasons: mediaDetails.media.seasons ? mediaDetails.media.seasons.length : null,
        episodeCount: mediaDetails.media.episodeCount,
        inProduction: mediaDetails.media.inProduction,
        firstAirDate: mediaDetails.media.firstAirDate,
        lastAirDate: mediaDetails.media.lastAirDate,
        status: mediaDetails.media.status
      } : null);
      this.log('📊 [Background] mediaDetails.mediaInfo:', mediaDetails.mediaInfo ? {
        status: mediaDetails.mediaInfo.status,
        inProduction: mediaDetails.mediaInfo.inProduction,
        seasons: mediaDetails.mediaInfo.seasons
      } : null);
      this.log('📊 [Background] mediaDetails.requests:', mediaDetails.requests ? mediaDetails.requests.length + ' requests' : null);

      this.log('📊 [Background] Full object keys for monitoring detection:', Object.keys(mediaDetails));
      if (mediaDetails.seasons) {
        this.log('📊 [Background] Seasons data available:', mediaDetails.seasons.length);
      }

      let status = null;
      let mediaUrl = null;
      let serviceUrl = null;
      // Seerr has two status enums. A request carries MediaRequestStatus
      // (pending/approved/declined/failed/completed) while media carries
      // MediaStatus (unknown/pending/processing/partial/available/
      // blocklisted/deleted). The same number means different things.
      let statusKind = 'media';

      if (mediaDetails.status !== undefined && mediaDetails.media) {
        status = mediaDetails.status;
        statusKind = 'request';
        mediaUrl = mediaDetails.media.mediaUrl;
        serviceUrl = mediaDetails.media.serviceUrl;
        this.log('📊 [Background] Found REQUEST object with status:', status);
        this.log('📊 [Background] Media has status', mediaDetails.media.status, 'but using request status', status);
      } else if (mediaDetails.requests && mediaDetails.requests.length > 0) {
        const latestRequest = mediaDetails.requests[0];
        status = latestRequest.status;
        statusKind = 'request';
        if (latestRequest.media) {
          mediaUrl = latestRequest.media.mediaUrl;
          serviceUrl = latestRequest.media.serviceUrl;
        }
        this.log('📊 [Background] Found status in requests array:', status);
      } else if (mediaDetails.mediaInfo && mediaDetails.mediaInfo.status !== undefined) {
        status = mediaDetails.mediaInfo.status;
        mediaUrl = mediaDetails.mediaInfo.mediaUrl;
        serviceUrl = mediaDetails.mediaInfo.serviceUrl;
        this.log('📊 [Background] Found status in mediaInfo:', status);
      } else if (mediaDetails.media && mediaDetails.media.status !== undefined) {
        status = mediaDetails.media.status;
        mediaUrl = mediaDetails.media.mediaUrl;
        serviceUrl = mediaDetails.media.serviceUrl;
        this.log('📊 [Background] Found status in media object:', status);
      } else if (mediaDetails.status !== undefined) {
        status = mediaDetails.status;
        this.log('📊 [Background] Found direct status:', status);
      }

      this.log('📊 [Background] Final extracted status:', status);
      this.log('📊 [Background] Media URLs - mediaUrl:', mediaUrl, 'serviceUrl:', serviceUrl);

      if (status === null || status === undefined) {
        this.log('📊 [Background] No status found, returning available for request');
        return {
          status: 'available',
          message: 'Not requested',
          buttonText: 'Request on Seerr',
          buttonClass: 'request'
        };
      }

      let result = {
        tmdbId: mediaDetails.id || mediaDetails.tmdbId,
        title: mediaDetails.name || mediaDetails.title || 'Unknown Title',
        status: 'unknown',
        message: 'Status unknown',
        buttonText: 'Request on Seerr',
        buttonClass: 'request'
      };

      if (mediaUrl) result.watchUrl = mediaUrl;
      if (serviceUrl) result.serviceUrl = serviceUrl;

      this.log('📊 [Background] Mapping', statusKind, 'status:', status, '(type:', typeof status, ') to UI format');
      this.log('📊 [Background] Raw status value for debugging:', JSON.stringify(status));

      const numericStatus = parseInt(status);
      if (isNaN(numericStatus)) {
        this.warn('📊 [Background] Unparseable status value:', status, 'treating as unknown');
        result.status = 'unknown';
        result.message = 'Status unavailable';
        result.buttonText = 'Request on Seerr';
        result.buttonClass = 'request';
        this.log('📊 [Background] Formatted status:', result);
        return result;
      }
      this.log('📊 [Background] Numeric status:', numericStatus);

      if (statusKind === 'request') this.applyRequestStatus(result, numericStatus, mediaUrl);
      else this.applyMediaStatus(result, numericStatus, mediaUrl, mediaDetails);

      const monitoringInfo = this.detectMonitoringStatus(mediaDetails, mediaType);
      if (monitoringInfo) {
        result.monitoring = monitoringInfo;
        this.log('📊 [Background] Monitoring info:', monitoringInfo);
      }

      this.log('📊 [Background] Formatted status:', result);
      return result;
    },

    // MediaRequestStatus: 1 pending, 2 approved, 3 declined, 4 failed,
    // 5 completed. These describe the request, not whether media exists.
    applyRequestStatus(result, status, mediaUrl) {
      switch (status) {
        case 1:
          result.status = 'pending';
          result.message = 'Request awaiting approval';
          result.buttonText = 'Request Pending';
          result.buttonClass = 'pending';
          break;

        case 2:
          result.status = 'pending';
          result.message = 'Request approved';
          result.buttonText = 'Request Approved';
          result.buttonClass = 'pending';
          break;

        case 3:
          result.status = 'declined';
          result.message = 'Request declined';
          result.buttonText = 'Request Declined';
          result.buttonClass = 'error';
          break;

        case 4:
          // Offer a retry: a failed request is the one case where requesting
          // again is the useful action.
          result.status = 'failed';
          result.message = 'Request failed';
          result.buttonText = 'Try Again';
          result.buttonClass = 'request';
          break;

        case 5:
          result.status = 'available_watch';
          result.message = this.availableMessage();
          result.buttonText = 'Available';
          result.buttonClass = 'available';
          if (mediaUrl) {
            result.watchUrl = mediaUrl;
            result.buttonText = this.watchButtonText();
            result.buttonClass = 'watch';
          }
          break;

        default:
          this.log('📊 [Background] Unknown request status:', status, 'treating as requestable');
          result.status = 'available';
          result.message = 'Ready to request';
          result.buttonText = 'Request on Seerr';
          result.buttonClass = 'request';
          break;
      }
      return result;
    },

    // MediaStatus: 1 unknown, 2 pending, 3 processing, 4 partially available,
    // 5 available, 6 blocklisted, 7 deleted.
    applyMediaStatus(result, status, mediaUrl, mediaDetails) {
      switch (status) {
        case 1:
          // Seerr treats UNKNOWN as "not requested" and offers the request.
          result.status = 'available';
          result.message = 'Ready to request';
          result.buttonText = 'Request on Seerr';
          result.buttonClass = 'request';
          break;

        case 2:
          result.status = 'pending';
          result.message = 'Request monitoring';
          result.buttonText = 'Request Pending';
          result.buttonClass = 'pending';
          break;

        case 3: {
          result.status = 'downloading';
          result.message = 'Processing download';
          result.buttonText = 'Processing...';
          result.buttonClass = 'downloading';

          const progress = this.extractDownloadProgress(mediaDetails);
          Object.assign(result, progress);
          if (progress.progress !== undefined) {
            result.message = `Download in progress (${progress.progress}%)`;
            result.buttonText = `Downloading ${progress.progress}%`;
          }
          break;
        }

        case 4:
          result.status = 'partial';
          result.message = 'Partially ready';
          result.buttonText = 'Partially Available';
          result.buttonClass = 'partial';
          if (mediaUrl) {
            result.message = this.availableMessage();
            result.watchUrl = mediaUrl;
            result.buttonText = this.watchButtonText();
            result.buttonClass = 'watch';
          }
          break;

        case 5:
          result.status = 'available_watch';
          result.message = this.availableMessage();
          result.buttonText = 'Available';
          result.buttonClass = 'available';
          if (mediaUrl) {
            result.watchUrl = mediaUrl;
            result.buttonText = this.watchButtonText();
            result.buttonClass = 'watch';
          }
          break;

        case 6:
          // Blocklisted on the server; requesting it cannot succeed.
          result.status = 'blocklisted';
          result.message = 'Blocklisted on Seerr';
          result.buttonText = 'Blocklisted';
          result.buttonClass = 'error';
          break;

        case 7:
          // Removed from the library, so requesting it again is the right offer.
          result.status = 'available';
          result.message = 'Ready to request';
          result.buttonText = 'Request on Seerr';
          result.buttonClass = 'request';
          break;

        default:
          this.log('📊 [Background] Unknown media status:', status, 'treating as available');
          result.status = 'available';
          result.message = 'Ready to request';
          result.buttonText = 'Request on Seerr';
          result.buttonClass = 'request';
          break;
      }
      return result;
    },

    // Seerr does not document download progress fields, so these are probed.
    extractDownloadProgress(mediaDetails) {
      const found = {};
      if (!mediaDetails) return found;
      const groups = {
        progress: ['progress', 'percentage', 'downloadProgress', 'completion', 'percent'],
        downloadSpeed: ['speed', 'downloadSpeed', 'rate', 'transferRate'],
        eta: ['eta', 'timeRemaining', 'estimatedCompletion', 'remainingTime'],
        downloadClient: ['downloadClient', 'downloader', 'client']
      };
      for (const [key, fields] of Object.entries(groups)) {
        for (const field of fields) {
          if (mediaDetails[field] !== undefined) found[key] = mediaDetails[field];
        }
      }
      return found;
    },

    detectMonitoringStatus(mediaDetails, mediaType) {
      if (!mediaDetails) return null;

      if (mediaType === 'tv') {
        const media = mediaDetails.media || mediaDetails.mediaInfo || mediaDetails;

        if (media.inProduction === true) {
          return { type: 'future_episodes', message: 'Monitoring new episodes', indicator: '📡' };
        }

        if (media.seasons && Array.isArray(media.seasons)) {
          const incompleteSeasons = media.seasons.filter(season => season.status !== 5);
          if (incompleteSeasons.length > 0) {
            return { type: 'future_seasons', message: `Monitoring ${incompleteSeasons.length} season(s)`, indicator: '📡' };
          }
        }
      }

      if (mediaType === 'movie') {
        const media = mediaDetails.media || mediaDetails.mediaInfo || mediaDetails;
        if (media.belongsToCollection && media.inProduction) {
          return { type: 'future_collection', message: 'Monitoring collection', indicator: '📡' };
        }
      }

      return null;
    },
  };
})(globalThis);
