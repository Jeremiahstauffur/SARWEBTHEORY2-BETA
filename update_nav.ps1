$navTemplate = @"
        <nav>
          <a href="home.html" id="nav-home" class="{ACTIVE_HOME}" title="Home"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg></a>
          <a href="index.html" id="nav-regions" class="{ACTIVE_INDEX}" title="Regions"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="12 2 2 7 12 12 22 7 12 2"></polyline><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg></a>
          <a href="page2.html" id="nav-segments" class="{ACTIVE_PAGE2}" title="Segments"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 9l4 11h12l4-11-10-7z"></path></svg></a>
          <a href="page3.html" id="nav-personnel" class="{ACTIVE_PAGE3}" title="Personnel"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg></a>
          <a href="page4.html" id="nav-search-log" class="{ACTIVE_PAGE4}" title="Search Log"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" x2="3.01" y1="18" y2="18"></line></svg><div class="par-check-dot" id="par-check-dot"></div></a>
          <a href="page5.html" id="nav-forms" class="{ACTIVE_PAGE5}" title="Forms"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg></a>
          <a href="page6.html" id="nav-profile" class="{ACTIVE_PAGE6}" title="Incident"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg></a>
          <a href="page10.html" id="nav-maps" class="{ACTIVE_PAGE10}" title="Maps"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"></polygon><line x1="8" y1="2" x2="8" y2="18"></line><line x1="16" y1="6" x2="16" y2="22"></line></svg></a>
          <a href="page7.html" id="nav-uploads" class="{ACTIVE_PAGE7}" title="Uploads"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg></a>
          <a href="page8.html?tab=manage" id="nav-users" class="{ACTIVE_PAGE9}" title="Users" style="display: none;"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg></a>
          <a href="#" id="profile-btn" class="profile-nav-btn {ACTIVE_PAGE8}"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg></a>
          <a href="settings.html" id="nav-settings" class="{ACTIVE_SETTINGS}" title="Settings"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg></a><div class="notification-bell" id="notif-bell"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg><div class="notification-dot" id="notif-dot"></div></div>
        </nav>
"@

$bottomNavTemplate = @"
    <nav class="bottom-nav">
        <a href="home.html" class="{ACTIVE_HOME}">
          <svg fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
          <span>Home</span>
        </a>
        <a href="index.html" class="{ACTIVE_INDEX}">
          <svg fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24"><polyline points="12 2 2 7 12 12 22 7 12 2"></polyline><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>
          <span>Regions</span>
        </a>
        <a href="page10.html" class="{ACTIVE_PAGE10}">
          <svg fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"></polygon><line x1="8" x2="8" y1="2" y2="18"></line><line x1="16" x2="16" y1="6" y2="22"></line></svg>
          <span>Maps</span>
        </a>
        <a href="page5.html" class="{ACTIVE_PAGE5}">
          <svg fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg>
          <span>Forms</span>
        </a>
        <a href="more.html" class="{ACTIVE_MORE}">
          <svg fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle><circle cx="5" cy="12" r="1"></circle></svg>
          <span>More</span>
        </a>
    </nav>
"@

Get-ChildItem -Filter *.html | ForEach-Object {
    $content = Get-Content $_.FullName -Raw
    $page = ""
    if ($content -match 'body data-page="([^"]+)"') { $page = $matches[1] }
    
    $nav = $navTemplate
    $bnav = $bottomNavTemplate

    $placeholders = @{
        "{ACTIVE_HOME}" = if ($page -eq "home") { "active" } else { "" }
        "{ACTIVE_INDEX}" = if ($page -eq "index") { "active" } else { "" }
        "{ACTIVE_PAGE2}" = if ($page -eq "page2") { "active" } else { "" }
        "{ACTIVE_PAGE3}" = if ($page -eq "page3") { "active" } else { "" }
        "{ACTIVE_PAGE4}" = if ($page -eq "page4") { "active" } else { "" }
        "{ACTIVE_PAGE5}" = if ($page -eq "page5") { "active" } else { "" }
        "{ACTIVE_PAGE6}" = if ($page -eq "page6") { "active" } else { "" }
        "{ACTIVE_PAGE7}" = if ($page -eq "page7" -or $page -eq "uploads") { "active" } else { "" }
        "{ACTIVE_PAGE8}" = if ($page -eq "page8") { "active" } else { "" }
        "{ACTIVE_PAGE9}" = if ($page -eq "page9") { "active" } else { "" }
        "{ACTIVE_PAGE10}" = if ($page -eq "page10") { "active" } else { "" }
        "{ACTIVE_MORE}" = if ($page -eq "more") { "active" } else { "" }
        "{ACTIVE_SETTINGS}" = if ($page -eq "settings") { "active" } else { "" }
    }

    foreach ($key in $placeholders.Keys) {
        $nav = $nav.Replace($key, $placeholders[$key])
        $bnav = $bnav.Replace($key, $placeholders[$key])
    }
    
    $content = $content -replace '(?s)<nav>.*?</nav>', $nav
    $content = $content -replace '(?s)<nav class="bottom-nav">.*?</nav>', $bnav
    Set-Content $_.FullName $content
}
