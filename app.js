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

// Create a Debug Log area dynamically
const debugDiv = document.createElement('div');
debugDiv.style.background = '#333';
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

// --- PKCE & AUTH ---
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

async function initiateLogin() {
    const selectedRegion = regionSelect.value;
    sessionStorage.setItem('selected_region', selectedRegion);
    log(`Starting Login for Region: ${selectedRegion}`);

    const codeVerifier = generateRandomString(64);
    sessionStorage.setItem('code_verifier', codeVerifier);
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    const state = generateRandomString(16);
    sessionStorage.setItem('oauth_state', state);

    const authUrl = new URL('https://eu.battle.net/oauth/authorize');
    authUrl.searchParams.append('client_id', CLIENT_ID);
    authUrl.searchParams.append('redirect_uri', REDIRECT_URI);
    authUrl.searchParams.append('response_type', 'code');
    authUrl.searchParams.append('scope', 'wow.profile');
    authUrl.searchParams.append('state', state);
    authUrl.searchParams.append('code_challenge', codeChallenge);
    authUrl.searchParams.append('code_challenge_method', 'S256');

    window.location.href = authUrl.toString();
}

async function handleCallback() {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const state = urlParams.get('state');

    // Restore region
    const savedRegion = sessionStorage.getItem('selected_region');
    if (savedRegion) regionSelect.value = savedRegion;

    if (code && state) {
        log("Callback received. Processing...");
        
        // Don't clear URL yet, so we can see what's happening
        loginSection.classList.add('hidden');
        resultsSection.classList.remove('hidden');

        const savedState = sessionStorage.getItem('oauth_state');
        if (state !== savedState) {
            log("ERROR: State mismatch. Possible security issue.");
            return;
        }

        const codeVerifier = sessionStorage.getItem('code_verifier');
        if (!codeVerifier) {
            log("ERROR: Code verifier missing from storage. Did the tab reload?");
            return;
        }

        log("Exchanging code for token...");
        try {
            const tokenResponse = await fetch('https://eu.battle.net/oauth/token', {
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
                log(`TOKEN ERROR: ${tokenResponse.status} - ${text}`);
                return;
            }

            const tokenData = await tokenResponse.json();
            log("Token received successfully.");
            sessionStorage.setItem('access_token', tokenData.access_token);
            
            fetchAchievementData();
        } catch (error) {
            log(`CRITICAL ERROR: ${error.message}`);
        }
    } else {
        const accessToken = sessionStorage.getItem('access_token');
        if (accessToken) {
            log("Found existing token. Loading data...");
            loginSection.classList.add('hidden');
            resultsSection.classList.remove('hidden');
            fetchAchievementData();
        } else {
            log("Ready to log in.");
        }
    }
}

async function fetchAchievementData() {
    const accessToken = sessionStorage.getItem('access_token');
    const region = sessionStorage.getItem('selected_region') || 'us'; 
    const apiBaseUrl = `https://${region}.api.blizzard.com`;
    const namespace = `profile-${region}`;

    log(`Fetching data from: ${apiBaseUrl}`);
    log(`Namespace: ${namespace}`);

    try {
        const response = await fetch(`${apiBaseUrl}/profile/user/wow/achievements?namespace=${namespace}`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        if (!response.ok) {
            log(`API ERROR: ${response.status} ${response.statusText}`);
            if (response.status === 401) log("401 means the Token is invalid or expired.");
            if (response.status === 404) log("404 means no WoW Account found on this Region.");
            if (response.status === 403) log("403 means Forbidden (Check scopes).");
            return;
        }

        log("Data received! Processing...");
        const data = await response.json();
        processLoremasterDeepDive(data);
    } catch (error) {
        log(`FETCH EXCEPTION: ${error.message}`);
    }
}

function findAchievement(data, id) {
    if (!data.achievements) return null;
    return data.achievements.find(a => a.id === id);
}

function processLoremasterDeepDive(data) {
    const loremaster = findAchievement(data, LOREMASTER_ACHIEVEMENT_ID);

    if (!loremaster) {
        log("Data loaded, but Loremaster ID 7520 not found in list.");
        log("This usually means you haven't started it, OR the API returned partial data.");
        return;
    }

    log("Loremaster data found. Rendering list...");
    const overallStatus = document.getElementById('overall-status');
    const overallProgressBar = document.getElementById('overall-progress-bar');
    
    // Calculate percentages
    const totalCriteria = loremaster.criteria.child_criteria.length;
    const completedCriteria = loremaster.criteria.child_criteria.filter(c => c.is_completed).length;
    const percent = Math.round((completedCriteria / totalCriteria) * 100);
    
    overallStatus.textContent = `Progress: ${percent}%`;
    overallProgressBar.style.width = `${percent}%`;

    renderExpansions(loremaster.criteria.child_criteria, data);
}

function renderExpansions(expansionCriteria, allData) {
    expansionList.innerHTML = '';
    
    expansionCriteria.forEach(expCrit => {
        const expId = expCrit.achievement.id; 
        const expData = findAchievement(allData, expId);
        
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
                const zoneData = findAchievement(allData, zoneId);
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


