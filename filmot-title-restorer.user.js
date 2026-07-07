// ==UserScript==
// @name         Filmot Title Restorer
// @namespace    http://tampermonkey.net/
// @version      0.49
// @license GPL-3.0-or-later; https://www.gnu.org/licenses/gpl-3.0.txt
// @description  Restores titles for removed or private videos in YouTube playlists
// @author       Jopik, Samg381
// @match        https://*.youtube.com/*
// @icon         https://www.google.com/s2/favicons?domain=filmot.com
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @connect      web.archive.org
// @require      https://cdnjs.cloudflare.com/ajax/libs/cash/8.1.5/cash.min.js
// ==/UserScript==

if (window.trustedTypes) {
    window.trustedTypes.createPolicy('default', {createHTML: (string, sink) => string})
}

// STATIC VALUES ===============================================================================================================

var darkModeBackground="#000099";
var lightModeBackground="#b0f2f4";
var darkModeLinkColor="#f1f1f1";






// UTILITY FUNCTIONS ===========================================================================================================

function escapeHTML(unsafe) {
    return unsafe.replace(
        /[\u0000-\u002F\u003A-\u0040\u005B-\u0060\u007B-\u00FF]/g,
        c => '&#' + ('000' + c.charCodeAt(0)).substr(-4, 4) + ';'
    )
}

function getWaybackVideoAvailabilityCheckURL(videoID) {
    return `https://web.archive.org/cdx/search/cdx?url=wayback-fakeurl.archive.org/yt/${videoID}&fl=timestamp,original&output=json&closest=20050101000000&limit=1`;
}

function waybackTimestampToDateString(timestamp) {
    return `${timestamp.slice(6, 8)}.${timestamp.slice(4, 6)}.${timestamp.slice(0, 4)}`;
}

function reportAJAXError(error) {
    alert("[Filmot] Error fetching API results " + error);
}

function rgb2lum(rgb) {
    // calculate relative luminance of a color provided by rgb() string
    // black is 0, white is 1
    rgb = rgb.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
    if (rgb.length==4) {
        var R=parseInt(rgb[1],10)/255.0;
        var G=parseInt(rgb[2],10)/255.0;
        var B=parseInt(rgb[3],10)/255.0;
        return 0.2126*R + 0.7152*G + 0.0722*B;
    }
    return 1;
}








// LISTENERS / FIRING LOGIC ====================================================================================================

document.addEventListener('yt-navigate-start', handleNavigateStart); // Detects when the page begins loading

document.addEventListener('yt-navigate-finish', handleNavigateFinish); // Detects when the page finishes loading

document.addEventListener("yt-action", e => { // Detects when scrolling causes new entries to appear (playlist page)
    if (e.detail?.actionName === "yt-store-grafted-ve-action") {
        handlePageDataLoad(e);
    }
});

// Fire at least once on load, sometimes handleNavigateFinish on first load yt-navigate-finish already fired before script loads
handleNavigateFinish();











// DISPATCHERS =================================================================================================================

function handleNavigateStart() {

    var filmotTitles=$(".filmot_title");
    filmotTitles.text("");
    filmotTitles.removeClass("filmot_title");

    var filmotChannels=$(".filmot_channel");
    filmotChannels.text("");
    filmotChannels.attr("onclick","");
    filmotChannels.removeClass("filmot_channel");

    cleanUP();
}


function handleNavigateFinish() {

    cleanUP();

    if (window.location.href.indexOf("/playlist?")>0)
    {
        console.log('[Filmot] Filmot Title Restorer loaded on playlist page.');
        setTimeout(extractIDsFullView, 500);
    }
    else if (window.location.href.indexOf("/watch?")>0)
    {
        console.log('[Filmot] Filmot Title Restorer loaded on single video page.');
        setTimeout(checkIfPrivatedOrRemoved, 500);
    }
}


function handlePageDataLoad(event){

    if (window.location.href.indexOf("/playlist?")>0)
    {
        console.debug("[Filmot] [DEBUG] New videos likely detected. Scanning new titles.");
        extractIDsFullView();
    }

}









// CORE OPERATIONS =============================================================================================================


function cleanUP() {
    /*
    cleanUP
    This function clears global variables and Filmot-added tags that are used by other parts of the script.
    */

    $(".filmot_hide").show();
    $(".filmot_hide").removeClass("filmot_hide");
    $(".filmot_newimg").remove();
    $(".filmot_highlight").css("background-color","");
    $(".filmot_highlight").removeClass("filmot_highlight");
    $("#TitleRestoredDiv").remove();
    $(".filmot_c_link").remove();
    $(".filmot_button").remove();
    window.ArchivedIDS={};
    window.RecoveredIDS={};
    window.DetectedIDS={};
}

function checkIfPrivatedOrRemoved() {
    /*
    checkIfPrivatedOrRemoved
    This function checks the HTTP response of a given video and evaluates it for age or playback errors
    */

    const playabilityStatus=unsafeWindow.ytInitialPlayerResponse.playabilityStatus;
    const status=playabilityStatus.status;
    if (status=="ERROR" || (status=="LOGIN_REQUIRED" && !playabilityStatus.valueOf().desktopLegacyAgeGateReason)) {
        var id=unsafeWindow.ytInitialData.currentVideoEndpoint.watchEndpoint.videoId;
        if (id.length>=11) {
            window.deletedIDs=id;
            window.deletedIDCnt=1;
            window.DetectedIDS[id]=1;
            processClick(2,0);
        }
    }
}

function createRestoreButton() {
    /*
    createRestoreButton
    This function is used on a playlist page to create a custom Filmot status box, indicating how many videos in the playlist have been restored.
    */

    // Time to create the 'Restore Titles' button in the Playlist Description Box (left side pane, beneath playlist thumbnail)
    console.log("[Filmot] [DEBUG] Creating 'Restore Titles' button in playlist description box.");

    /////////////////////////////////////////////// PLEASE READ /////////////////////////////////////////////////////////////////////////////
    // For some reason, YouTube (or a browser plugin) sometimes creates one or more duplicate, commented-out Description Boxes.
    // Therefore, we locate all Playlist Description Box elements (classes) where 'restore titles' buttons can be placed, and place them in an array.
    // This is admittedly a scorched-earth method, but I am tired of YouTube constantly changing element IDs and breaking this.
    // Note: these are class names.
    var metactionbars = Array.from(document.querySelectorAll('.description.style-scope.ytd-playlist-header-renderer, .ytPageHeaderViewModelContentMetadata.ytPageHeaderViewModelContentMetadataOverlay.ytContentMetadataViewModelHost')).filter(el => el.offsetParent !== null);

    //        ^^^^^ UPDATE THIS WHEN YOUTUBE BREAKS SIDEBAR ELEMENT IDs ^^^^^
    //
    // Note for updaters in the future: This list of descendant selectors can be cleverly structured to add redundancy.
    //                                  The below logic will search for the first valid location to place a button.
    //                                  You can add multiple selectors. If one fails (YouTube UI update), the next valid one will be used.
    //
    /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

    // console.log(metactionbars);

    // Check if the metaactionbars array isn't empty.
    if (metactionbars !== undefined || metactionbars.length != 0) {
        // Loop through every possible button placement location in sidebar
        for (var i = metactionbars.length - 1; i >= 0; i--) {
            // Discard potential placement locations that are invisible (see large comment block above)
            if (!metactionbars[i].checkVisibility()) {
                console.debug("[Filmot] [DEBUG] [" + i + "/" + metactionbars.length + "] Skipping commented code region.");
                continue;
            }

            console.debug("[Filmot] [DEBUG] [" + i + "/" + metactionbars.length + "] Attempting to attach restore button.");

            // Create the container div
            var containerDiv = document.createElement('div');
            containerDiv.id = 'TitleRestoredDiv';
            containerDiv.style.textAlign = 'center';

            // Create the button
            var button = document.createElement('button');
            button.id = 'TitleRestoredBtn';
            button.textContent = 'Restore Titles';

            // Create the link
            var link = document.createElement('a');
            link.href = 'https://filmot.com';
            link.target = '_blank';
            link.style.color = 'white';
            link.style.fontSize = 'large';
            link.textContent = 'Powered by filmot.com';

            // Assemble the elements
            containerDiv.appendChild(document.createElement('br'));
            containerDiv.appendChild(button);
            containerDiv.appendChild(document.createElement('br'));
            containerDiv.appendChild(link);

            // Insert the container at the beginning of metactionbar
            metactionbars[i].insertBefore(containerDiv, metactionbars[i].firstChild);

            // Break out of loop, as we have now added a restore button in a presumably visible location.
            break;
        }
    }
    else {
        console.debug("[Filmot] [DEBUG] ERROR: Could not locate playlist sidebar to place restore button.");
    }

}

function extractIDsFullView() {
    /*
    extractIDsFullView
    This function fires on a playlist page (Liked Videos, Favorites, Custom Playlist)
    It detects deleted videos (assuming user has clicked 'show unavailable videos') and fetches their video ID.
    This list of unavailable video IDs are added to a global variable which is accessed by other parts of the script.
    */

    window.deletedIDs = "";
    window.deletedIDCnt = 0;

    var deletedIDs = "";
    var deletedIDsCnt = 0;

    // Find all unavailable video elements in the playlist.
    // Depending on the type of playlist, the video element may be different.
    // As of this writing:
    // Liked Videos: yt-lockup-view-model
    // Favorites: ytd-playlist-video-renderer
    // Custom: ytd-playlist-video-renderer

    // Generate an array of all videos on playlist page.
    // Each playlist type has a different way of displaying videos, so we comingle all cases.
    console.debug('[Filmot] [DEBUG] Fetching all videos on playlist page.');

    const videoEntries = Array.from(
        document.querySelectorAll("yt-lockup-view-model, ytd-playlist-video-renderer")
    );

    if (!videoEntries.length) {
        console.log("[Filmot] [DEBUG] No videos found on playlist page. This is likely an error.");
        return;
    }

    console.debug('[Filmot] [DEBUG] printing all videos found on page:');
    console.debug(videoEntries);



    // From our previously generated list of all visible videos, identify deleted/private/unavailable ones.
    // Each playlist type has a different way of indicating a video is unavailble, so we comingle all cases.
    console.debug('[Filmot] [DEBUG] Detecting unavailable videos on playlist page.');
    const deletedVideos = videoEntries.filter(lockup =>
        lockup.textContent.includes("No views") ||
        lockup.textContent.includes("[Deleted video]") ||
        lockup.textContent.includes("[Private video]")
    );

    if (!deletedVideos.length) {
        console.debug("[Filmot] [DEBUG] Found videos on playlist page, but none that were unavailable.");

        console.debug("[Filmot] [DEBUG] Printing the text content of all video entry elements on page:");

        for (const entry of videoEntries) {
            console.debug("-----");
            console.debug(entry.textContent);
        }

        return;
    }

    console.debug('[Filmot] [DEBUG] printing unavailable videos found on page:');
    console.debug(deletedVideos);





    console.debug(
        `[Filmot] Found ${videoEntries.length} visible videos (${deletedVideos.length} presumed deleted/private).`
    );

    // Extract IDs from deleted videos only
    deletedVideos.forEach(lockup => {

        // Find the watch link inside the lockup
        const link = lockup.querySelector('a[href*="/watch?v="]');
        if (!link) return;

        // Skip already processed entries (prevents duplicates on re-scan)
        if (link.hasAttribute("filmot_chk")) return;

        const href = link.getAttribute("href");

        // Extract video ID safely from URL
        const match = href.match(/[?&]v=([A-Za-z0-9_-]{11})/);
        if (!match) return;

        const id = match[1];

        // Mark as processed
        link.setAttribute("filmot_chk", "1");

        // Register globally
        window.DetectedIDS[id] = 1;

        // Build CSV list of deleted video IDs
        if (deletedIDs.length > 0) {
            deletedIDs += ",";
        }
        deletedIDs += id;

        deletedIDsCnt++;
    });

    // Save state globally
    window.deletedIDs = deletedIDs;
    window.deletedIDCnt = deletedIDsCnt;

    if (deletedIDsCnt > 0) {

        console.debug(`[Filmot] [DEBUG] There are ${deletedIDsCnt} titles to restore.`);

        // Ensure restore button is only created once (check if our custom ID already exists on the element)
        if (document.getElementById("TitleRestoredBtn") === null) {
            createRestoreButton();
        }

        // Trigger downstream processing
        console.debug(`[Filmot] [DEBUG] Firing processClick`);
        processClick(1, 0);

    } else {
        console.log("[Filmot] [DEBUG] No titles found to restore.");
    }
}

function processJSONResultSingleVideo(fetched_details, format) {
    /*
    processJSONResultSingleVideo
    This function accepts a JSON list of Filmot info on a single video that was previously identified as deleted.
    This function parses this list of information, and attempts to 'fill in the blanks' on the video error page.
    Since the video was deleted / removed, the playback page will contain some form of error / warning.
    */

    if (format != 2) {
        console.error("[Filmot] Internal error: processJSONResultSingleVideo called for format other than 1 (single video)");
        return;
    }

    var darkMode = -1;
    for (let i = 0; i < fetched_details.length; ++i) {
        var meta = fetched_details[i];
        var escapedTitle = meta.title;

        let item;
        // Dead channel or deleted/private video (non-player error)
        let parentItem = $("ytd-background-promo-renderer");
        if (parentItem.length) {
            item = parentItem.find("div.promo-message").first();

            parentItem.css("padding-top", "100px");
        } else {
            // Video removed for policy violations (player error)
            parentItem = $("div#player");
            item = parentItem.find("#subreason.yt-player-error-message-renderer").first();

            // Make player error take up the whole screen, only if there is no playlist panel visible on the page
            const playlistPanel = $("ytd-playlist-panel-renderer");
            if (!playlistPanel.length || playlistPanel.attr("hidden") !== undefined) {
                parentItem.css("position", "unset");
            }
        }

        if (darkMode == -1) {
            var lum = rgb2lum(item.css("color"));
            darkMode = (lum > 0.51) ? 1 : 0; // if text is bright it means we are in dark mode
        }

        if (!window.RecoveredIDS[meta.id]) {
            window.RecoveredIDS[meta.id] = 1;
            if (meta.channelname == null) {
                meta.channelname = fetched_details[i].channelid;
            }

            // Create "Powered by Filmot" link
            var brEl = document.createElement('br');
            item[0].appendChild(brEl);

            var poweredByFilmot = document.createElement('a');
            poweredByFilmot.style.fontSize = 'large';
            poweredByFilmot.className = 'yt-simple-endpoint style-scope yt-formatted-string';
            poweredByFilmot.href = 'https://filmot.com';
            poweredByFilmot.target = '_blank';
            poweredByFilmot.textContent = 'Title and Channel from filmot.com';
            item[0].appendChild(poweredByFilmot);

            // Create title link
            var titleContainer = document.createElement('h2');
            titleContainer.textContent = 'Title: ';
            var titleLink = document.createElement('a');
            titleLink.className = 'filmot_c_link yt-simple-endpoint style-scope yt-formatted-string';
            titleLink.dir = 'auto';
            titleLink.href = 'https://filmot.com/video/' + meta.id;
            titleLink.textContent = escapedTitle;
            titleLink.style.color = ((darkMode == 0) ? 'black': 'white');
            titleContainer.appendChild(titleLink);
            item[0].appendChild(titleContainer);

            // Create channel link
            var channelContainer = document.createElement('h2');
            channelContainer.textContent = 'Channel: ';
            var channelLink = document.createElement('a');
            channelLink.className = 'filmot_c_link yt-simple-endpoint style-scope yt-formatted-string';
            channelLink.dir = 'auto';
            channelLink.href = 'https://www.youtube.com/channel/' + meta.channelid;
            channelLink.textContent = meta.channelname;
            channelContainer.appendChild(channelLink);
            item[0].appendChild(channelContainer);

            // Create thumbnail image
            var newThumb = document.createElement('img');
            newThumb.id = 'filmot_newimg';
            newThumb.className = 'style-scope yt-img-shadow filmot_newimg';
            newThumb.onclick = function(event) {
                prompt('Full Title', escapedTitle);
                event.stopPropagation();
                return false;
            };
            newThumb.title = escapedTitle;
            newThumb.width = 320;
            newThumb.src = 'https://filmot.com/vi/' + meta.id + '/default.jpg';
            item[0].appendChild(newThumb);

            // Create Wayback Machine archive check/view button
            const waybackButton = $('<button-view-model>')
                .addClass("filmot_button yt-spec-button-view-model")
                .css("margin-bottom", "10px");
            const anchor = $('<a>')
                .addClass("yt-spec-button-shape-next yt-spec-button-shape-next--filled yt-spec-button-shape-next--overlay yt-spec-button-shape-next--size-m yt-spec-button-shape-next--icon-leading yt-spec-button-shape-next--enable-backdrop-filter-experiment")
                .attr({
                    "target": "_blank",
                    "aria-haspopup": "false",
                    "force-new-state": "true",
                    "aria-disabled": "false",
                    "aria-label": "Check/view Wayback archive",
                    "videoID": meta.id
                })
                .css("background-color", "thistle")
                .one("click", function() {
                    $(this).css("opacity", 0.5);
                    $(this).find("#state-text").text("Checking...");

                    const videoID = $(this).attr("videoID");
                    console.log(`[Filmot] [DEBUG] Checking Wayback Machine for archives of video "${videoID}"...`);
                    GM_xmlhttpRequest({
                        method: "GET",
                        url: getWaybackVideoAvailabilityCheckURL(videoID),
                        onload: (response) => {
                            try {
                                const data = JSON.parse(response.responseText);
                                if (data.length > 1) {
                                    const timestamp = data[1][0];
                                    $(this).attr("href", `https://web.archive.org/web/${timestamp}oe_/${data[1][1]}`)
                                        .css("background-color", "limegreen")
                                        .find("#state-text").text("Available: " + waybackTimestampToDateString(timestamp));
                                } else {
                                    $(this).css("background-color", "lightcoral")
                                        .find("#state-text").text("Not Available");
                                }
                                $(this).css("opacity", 1);
                            } catch (err) {
                                console.error("[Filmot] Error parsing video archive availability data from Wayback Machine!", err)
                            }
                        },
                        onerror: (err) => console.error("[Filmot] Error fetching video archive availability data from Wayback Machine!", err)
                    });
                });
            const iconWrapper = $('<div>')
                .addClass("yt-spec-button-shape-next__icon")
                .attr("aria-hidden", "true");
            const icon = $('<img>')
                .attr("src", "https://www.google.com/s2/favicons?domain=archive.org")
                .css({
                    "margin-left": "3px",
                    "margin-top": "5px"
                });
            const text = $('<div>')
                .addClass("yt-spec-button-shape-next__button-text-content")
                .attr("id", "state-text")
                .text("Check For Archives");
            iconWrapper.append(icon);
            anchor.append(iconWrapper);
            anchor.append(text);
            waybackButton.append(anchor);
            parentItem.find("div#buttons").prepend(waybackButton);
        }
    }
}

function processJSONResultFullView(fetched_details, format) {
    /*
    processJSONResultFullView
    This function accepts a JSON list of Filmot info on one or more deleted of videos of a PLAYLIST page (NOT a single video)
    It parses this list of information, and attempts to 'fill in the blanks' on the playlist page.
    */

    // Ensure this function was properly called, as it is only designed to handle restoring videos on a playlist page.
    if (format != 1) {
        console.error("[Filmot] Internal error: processJSONResultFullView called for format other than 1 (multiple videos)");
        return;
    }

    var darkMode = -1;

    console.debug('[Filmot] [DEBUG] processJSONResultFullView called on playlist page to restore ' + fetched_details.length + ' videos.')




    // Generate an array of all videos on playlist page.
    // Each playlist type has a different way of displaying videos, so we comingle all cases.
    console.debug('[Filmot] [DEBUG] Fetching all videos on playlist page.');

    // Fetch the HTML elements of each video entry on the playlist page.
    const videoEntries = Array.from(
        document.querySelectorAll( // Liked video entry, favorite video entry,
            ".ytLockupViewModelWrapper, .style-scope.ytd-playlist-video-list-renderer"
        )
    );

    if (!videoEntries.length) {
        console.log("[Filmot] [DEBUG] No videos found on playlist page. This is likely an error.");
        return;
    }

    console.debug("[Filmot] [DEBUG] Found", videoEntries.length, "video elements on page.");
    //console.debug('[Filmot] [DEBUG] printing all videos found on page:');
    //console.debug(videoEntries);




    // Create a list containing HTML elements of videos that we previously identified as missing/deleted
    var videoEntriesMatching = [];

    for (let i = 0; i < videoEntries.length; i++) {
        let entry = videoEntries[i];

        let href = entry.querySelector("a[href*='/watch?v=']")?.getAttribute("href");

        if (!href) continue;

        for (let j = 0; j < fetched_details.length; j++) {
            if (href.includes(fetched_details[j].id)) {
                videoEntriesMatching.push(entry);

                break;
            }
        }
    }

    console.debug("[Filmot] [DEBUG] Detected", videoEntriesMatching.length, 'missing video elements on page');


    for (let i = 0; i < videoEntriesMatching.length; i++) {
        let item = videoEntriesMatching[i];

        let href = item.querySelector("a[href*='/watch?v=']")?.getAttribute("href");
        if (!href) continue;

        let meta = fetched_details.find(m => href.includes(m.id));
        if (!meta) continue;





        // Attempt to delete the ugly missing title element
        // Account for title elements of various playlist types (Liked, Favorites, Custom)
        let title =
            videoEntriesMatching[i].querySelector(".ytLockupMetadataViewModelTitle span") ||
            videoEntriesMatching[i].querySelector(".yt-simple-endpoint.style-scope.ytd-playlist-video-renderer") ||
            videoEntriesMatching[i].querySelector(".ytAttributedStringHost.ytAttributedStringWhiteSpacePreWrap") ||
            videoEntriesMatching[i].querySelector(".someFutureSelector");

        console.debug('   [Filmot] [DEBUG] missing video title:', i, title?.textContent);

        title.remove()





        window.RecoveredIDS[meta.id] = 1;

        if (item.querySelector(".filmot_missing_panel")) continue;

        let container =
            item.querySelector(".ytLockupViewModelMetadata") || item;

        // Base panel
        let panel = document.createElement("div");
        panel.className = "filmot_missing_panel";

        panel.style.marginTop = "6px";
        panel.style.padding = "8px 10px";
        panel.style.borderRadius = "10px";
        panel.style.display = "flex";
        panel.style.flexDirection = "column";
        panel.style.gap = "6px";

        panel.style.background =
            (typeof darkMode !== "undefined" && darkMode == 1)
            ? darkModeBackground
        : lightModeBackground;

        panel.style.border = "1px solid rgba(255,255,255,0.08)";

        // Title
        let titleEl = document.createElement("div");
        titleEl.textContent = meta.title;

        titleEl.style.fontSize = "14px";
        titleEl.style.fontWeight = "600";
        titleEl.style.lineHeight = "1.3";

        titleEl.style.color =
            (typeof darkMode !== "undefined" && darkMode == 1)
            ? "#ffffff"
        : "#111111";

        titleEl.style.cursor = "pointer";

        titleEl.style.display = "-webkit-box";
        titleEl.style.webkitLineClamp = "2";
        titleEl.style.webkitBoxOrient = "vertical";
        titleEl.style.overflow = "hidden";

        titleEl.onclick = function (e) {
            prompt("Full Title", meta.title);
            e.stopPropagation();
        };

        // channel name
        let channelEl = document.createElement("a");
        channelEl.textContent = meta.channelname || meta.channelid;
        channelEl.href = "https://www.youtube.com/channel/" + meta.channelid;
        channelEl.target = "_blank";

        channelEl.style.fontSize = "12px";
        channelEl.style.opacity = "0.85";
        channelEl.style.textDecoration = "none";

        channelEl.style.color =
            (typeof darkMode !== "undefined" && darkMode == 1)
            ? darkModeLinkColor
        : "#065fd4"; // YouTube blue fallback for light mode

        channelEl.style.width = "fit-content";

        channelEl.onmouseenter = () => channelEl.style.textDecoration = "underline";
        channelEl.onmouseleave = () => channelEl.style.textDecoration = "none";

        // button container
        let buttonRow = document.createElement("div");
        buttonRow.style.display = "flex";
        buttonRow.style.gap = "8px";
        buttonRow.style.marginTop = "2px";

        function makeBtn(label, bg) {
            let b = document.createElement("a");
            b.textContent = label;
            b.style.fontSize = "12px";
            b.style.padding = "3px 8px";
            b.style.borderRadius = "6px";
            b.style.textDecoration = "none";
            b.style.color = "#fff";
            b.style.background = bg;
            b.style.display = "inline-flex";
            b.style.alignItems = "center";
            return b;
        }

        // Filmot button
        let filmotBtn = makeBtn("Filmot", "#d33");
        filmotBtn.href = "https://filmot.com/video/" + meta.id;
        filmotBtn.target = "_blank";

        // Wayback button
        let waybackBtn = makeBtn("Archive", "#666");
        waybackBtn.target = "_blank";

        let archiveData = window.ArchivedIDS?.[meta.id];

        if (typeof archiveData === "object") {
            waybackBtn.href = archiveData.url;
            waybackBtn.textContent = "Archived";
            waybackBtn.style.background = "green";

        } else if (archiveData === false) {
            waybackBtn.textContent = "None";
            waybackBtn.style.background = "#a33";

        } else {
            waybackBtn.href = "#";

            waybackBtn.addEventListener("click", function (e) {
                e.preventDefault();

                waybackBtn.textContent = "Checking...";
                waybackBtn.style.opacity = "0.6";

                GM_xmlhttpRequest({
                    method: "GET",
                    url: getWaybackVideoAvailabilityCheckURL(meta.id),

                    onload: function (res) {
                        try {
                            const data = JSON.parse(res.responseText);

                            if (data.length > 1) {
                                const timestamp = data[1][0];

                                const archive = {
                                    timestamp,
                                    url: `https://web.archive.org/web/${timestamp}oe_/${data[1][1]}`
                                };

                                window.ArchivedIDS[meta.id] = archive;

                                waybackBtn.href = archive.url;
                                waybackBtn.textContent = "Archived";
                                waybackBtn.style.background = "green";

                            } else {
                                window.ArchivedIDS[meta.id] = false;
                                waybackBtn.textContent = "None";
                                waybackBtn.style.background = "#a33";
                            }

                            waybackBtn.style.opacity = "1";
                        } catch (e) {
                            console.error("Wayback parse error", e);
                        }
                    },

                    onerror: function (err) {
                        console.error("Wayback request failed", err);
                    }
                });
            });
        }

        buttonRow.appendChild(filmotBtn);
        buttonRow.appendChild(waybackBtn);

        // put everything together
        panel.appendChild(titleEl);
        panel.appendChild(channelEl);
        panel.appendChild(buttonRow);

        container.appendChild(panel);
    }

    $("#TitleRestoredBtn").text(Object.keys(window.RecoveredIDS).length + " of " + Object.keys(window.DetectedIDS).length + " restored");

}

function processClick(format, nTry) {
    /*
    processClick:
    Accepts either a list of removed/unavailable video IDs, or a single removed/unavailable ID
    Queries the Filmot API on said video(s) to fetch JSON result containing missing video info.
    Passes JSON result to 1 of 2 functions depending on whether it is a playlist or single video page.
    format: 1 = list of video IDs, 2 = single video ID
    nTry: desired number of Filmot API retries
    */

    console.debug('[Filmot] [DEBUG] processClick initiated.')

    var maxTries = 2;
    var apiURL = 'https://filmot.com/api/getvideos?key=md5paNgdbaeudounjp39&id=' + window.deletedIDs;

    fetch(apiURL)
        .then(response => {
        if (!response.ok) {
            console.error("[Filmot] Network response failure (Filmot API).");
            throw new Error('[Filmot] Network response failure (Filmot API).');
        }
        return response.json();
    })
        .then(data => {
        if (format == 1) {
            console.debug('[Filmot] [DEBUG] Successfully received data from Filmot API. Calling playlist page processing.')
            processJSONResultFullView(data, format); // Pass json list of video info to playlist page handler.
        } else if (format == 2) {
            console.debug('[Filmot] [DEBUG] Successfully received data from Filmot API. Calling single video page processing.')
            processJSONResultSingleVideo(data, format); // Pass json list of video info to single video page handler.
        }
        else {
            console.error('[Filmot] Internal error: invalid video format in processClick.')
        }
    })
        .catch(error => {
        if (nTry >= maxTries) {
            console.error("[Filmot] filmot fetch error:", error);
            console.error("[Filmot] filmot fetch message:", error.message);
            console.error("[Filmot] filmot fetch stack:", error.stack);

            reportAJAXError(apiURL + " " + JSON.stringify(error));
            return;
        }
        processClick(format, nTry + 1); // Retry
    })
        .finally(() => {
        // This function will be called regardless of success or failure
    });

}

function ButtonClickActionFullView (zEvent) {
    processClick(2,0);
    return false;
}
