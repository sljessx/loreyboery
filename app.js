// --- Configuration ---
const CLIENT_ID = '2d44be25ffc847c4ba98bbeb9d352535';
const REDIRECT_URI = 'https://sljessx.github.io/loreyboery/'; 

const LOREMASTER_ACHIEVEMENT_ID = 7520; 

// --- ELEMENTS ---
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const regionSelect = document.getElementById('region-select');
const loginSection = document.getElementById('login-section');
const resultsSection = document.getElementById('results-section');
const expansionList = document.getElementById('expansion-list');

// --- DEBUG LOG ---
const debugDiv = document.createElement('div');
debugDiv.style.background = '#222';
debugDiv.style.color = '#0f0';
debugDiv.style.padding = '10px';
debugDiv.style.marginTop = '20px';
debugDiv.style.fontFamily = 'monospace';
debugDiv.style.whiteSpace = 'pre-wrap';
document.querySelector('main').appendChild(debugDiv);

function log(msg) {
    console.log(msg);
    debugDiv.innerHTML += msg + '\n';
}

// --- PKCE ---
function generateRandomString(length) {
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    let result = '';
    const randomValues = new Uint32Array(length);
    window.crypto.getRandomValues(randomValues);
    for (let i = 0; i < length; i++) {
        result += charset[randomValues[i] % charset.length];
    }
    return result;
}

async function generateCodeChallenge(codeVerifier) {
    const encoder = new TextEncoder();
    const data = encoder.encode(codeVerifier);
    const digest = await window.crypto.subtle.digest('SHA-256', data);
    return btoa(String.fromCharCode(...new Uint8Array(digest)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

// --- STEP 1: LOGIN (Global Server) ---
async function initiateLogin() {
    const region = regionSelect.value; 
    sessionStorage.setItem('selected_region', region);
    
    log(`Initializing Login for Region: ${region.toUpperCase()}`);

    const codeVerifier = generateRandomString(64);
    sessionStorage.setItem('code_verifier', codeVerifier);
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    const state = generateRandomString(16);
    sessionStorage.setItem('oauth_state', state);

    // FIX: Always use the GLOBAL oauth.battle.net server for login
    // The Region selection is saved for Step 3 (Data Fetch)
    const authUrl = new URL('https://oauth.battle.net/authorize');
    
    authUrl.searchParams.append('client_id', CLIENT_ID);
    authUrl.searchParams.append('redirect_uri', REDIRECT_URI);
    authUrl.searchParams.append('response_type', 'code');
    authUrl.searchParams.append('scope', 'wow.profile');
    authUrl.searchParams.append('state', state);
    authUrl.searchParams.append('code_challenge', codeChallenge);
    authUrl.searchParams.append('code_challenge_method', 'S256');

    // Optional: Hint the region to Blizzard
    if (region === 'eu') authUrl.searchParams.append('region', 'eu');

    window.location.href = authUrl.toString();
}

// --- STEP 2: CALLBACK & TOKEN (Global Server) ---
async function handleCallback() {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const state = urlParams.get('state');

    // Restore the dropdown visual
    const savedRegion = sessionStorage.getItem('selected_region') || 'us';
    regionSelect.value = savedRegion;

    if (code && state) {
        log(`Callback received. Swapping code on Global Server...`);
        
        loginSection.classList.add('hidden');
        resultsSection.classList.remove('hidden');

        // Security Checks
        const savedState = sessionStorage.getItem('oauth_state');
        if (state !== savedState) {
            log("SECURITY ERROR: State mismatch.");
            return;
        }
        const codeVerifier = sessionStorage.getItem('code_verifier');
        if (!codeVerifier) {
            log("ERROR: Code verifier missing.");
            return;
        }

        try {
            // FIX: Always use GLOBAL token endpoint
            const tokenUrl = 'https://oauth.battle.net/token';

            const tokenResponse = await fetch(tokenUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    client_id: CLIENT_ID,
                    redirect_uri: REDIRECT_URI,
                    grant_type: 'authorization_code',
                    code: code,
                    code_verifier: codeVerifier
                })
            });

            if (!tokenResponse.ok) {
                const text = await tokenResponse.text();
                log(`TOKEN ERROR: ${tokenResponse.status}`);
                log(`Details: ${text}`);
                return;
            }

            const tokenData = await tokenResponse.json();
            log("Token acquired! Fetching profile data...");
            sessionStorage.setItem('access_token', tokenData.access_token);
            
            fetchAchievementData();
        } catch (error) {
            log(`CRITICAL ERROR: ${error.message}`);
        }
    } else {
        const accessToken = sessionStorage.getItem('access_token');
        if (accessToken) {
            log("Session found. Loading data...");
            loginSection.classList.add('hidden');
            resultsSection.classList.remove('hidden');
            fetchAchievementData();
        } else {
            log("Ready. Select region and log in.");
        }
    }
}

// --- STEP 3: DATA FETCH (Regional Server) ---
async function fetchAchievementData() {
    const accessToken = sessionStorage.getItem('access_token');
    const region = sessionStorage.getItem('selected_region') || 'us'; 
    
    // FIX: This is where the Region matters!
    const apiBaseUrl = `https://${region}.api.blizzard.com`;
    const namespace = `profile-${region}`;

    log(`Querying API: ${apiBaseUrl}`);

    try {
        const response = await fetch(`${apiBaseUrl}/profile/user/wow/achievements?namespace=${namespace}`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        if (!response.ok) {
            log(`API DATA ERROR: ${response.status}`);
            if (response.status === 401) log("401 means the Token is valid, but not for this region's API.");
            if (response.status === 404) log("404 means no WoW Account found on this Region.");
            return;
        }

        const data = await response.json();
        processLoremasterDeepDive(data);
    } catch (error) {
        log(`FETCH ERROR: ${error.message}`);
    }
}

function processLoremasterDeepDive(data) {
    if (!data.achievements) { log("No achievement data found."); return; }
    
    const loremaster = data.achievements.find(a => a.id === LOREMASTER_ACHIEVEMENT_ID);
    if (!loremaster) {
        log("Loremaster Achievement (ID 7520) not found in your list.");
        log("This means you haven't completed it, but also haven't started tracking it?");
        return;
    }

    log("Rendering Loremaster Data...");
    const overallStatus = document.getElementById('overall-status');
    const overallProgressBar = document.getElementById('overall-progress-bar');
    
    const total = loremaster.criteria.child_criteria.length;
    const completed = loremaster.criteria.child_criteria.filter(c => c.is_completed).length;
    const percent = Math.round((completed / total) * 100);
    
    overallStatus.textContent = `Progress: ${percent}%`;
    overallProgressBar.style.width = `${percent}%`;

    renderExpansions(loremaster.criteria.child_criteria, data);
}

function renderExpansions(expansionCriteria, allData) {
    expansionList.innerHTML = '';
    
    expansionCriteria.forEach(expCrit => {
        const expId = expCrit.achievement.id; 
        const expData = allData.achievements.find(a => a.id === expId);
        
        const expLi = document.createElement('li');
        expLi.className = `achievement-item ${expCrit.is_completed ? 'completed' : 'incomplete'}`;
        expLi.style.flexDirection = 'column';
        expLi.style.alignItems = 'flex-start';

        expLi.innerHTML = `<strong>Achievement ${expId}</strong>: ${expCrit.is_completed ? 'Done' : 'In Progress'}`;

        if (!expCrit.is_completed && expData && expData.criteria) {
            const zoneList = document.createElement('ul');
            zoneList.style.fontSize = '0.9em';
            zoneList.style.marginTop = '5px';
            
            const zoneCriteria = expData.criteria.child_criteria || [expData.criteria];

            zoneCriteria.forEach(zoneCrit => {
                if (zoneCrit.is_completed) return;
                
                const zoneId = zoneCrit.achievement ? zoneCrit.achievement.id : 'Unknown';
                const zoneData = allData.achievements.find(a => a.id === zoneId);
                let detailText = "Incomplete";

                if (zoneData) {
                    if (zoneData.criteria.amount !== undefined) {
                        detailText = `${zoneData.criteria.amount} / ${zoneData.criteria.max} Quests`;
                    } else if (zoneData.criteria.child_criteria) {
                         const missing = zoneData.criteria.child_criteria
                            .filter(c => !c.is_completed)
                            .map(c => c.description).join(', ');
                         detailText = missing || "Chapters missing";
                    }
                }
                
                const zLi = document.createElement('li');
                zLi.innerHTML = `Zone ${zoneId}: ${detailText}`;
                zoneList.appendChild(zLi);
            });
            expLi.appendChild(zoneList);
        }
        expansionList.appendChild(expLi);
    });
}

loginBtn.addEventListener('click', initiateLogin);
if(logoutBtn) logoutBtn.addEventListener('click', () => {
    sessionStorage.clear();
    window.location.href = window.location.pathname;
});
regionSelect.addEventListener('change', () => sessionStorage.setItem('selected_region', regionSelect.value));

handleCallback();
