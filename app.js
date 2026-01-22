// --- Configuration ---
const CLIENT_ID = '0e53703a28dc4d9681b7a159b8a4df37'; // <--- PUT YOUR CLIENT ID HERE
// Dynamic Redirect URI (Must match Blizzard Developer Portal exactly)
// IMPORTANT: PASTE YOUR EXACT GITHUB PAGES URL HERE.
// It must match the Blizzard Developer Portal EXACTLY.
// Example: 'https://yourname.github.io/your-repo/'
const REDIRECT_URI = 'https://sljessx.github.io/loreyboery/'; 

const LOREMASTER_ACHIEVEMENT_ID = 7520; 

// --- DOM Elements ---
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const regionSelect = document.getElementById('region-select');
const loginSection = document.getElementById('login-section');
const loadingSection = document.getElementById('loading-section');
const resultsSection = document.getElementById('results-section');
const overallStatus = document.getElementById('overall-status');
const overallProgressBar = document.getElementById('overall-progress-bar');
const expansionList = document.getElementById('expansion-list');

// --- Helper: Restore Region Selection ---
// This ensures that if you pick EU, it stays EU even if the page reloads.
function restoreRegion() {
    const savedRegion = sessionStorage.getItem('selected_region');
    if (savedRegion) {
        regionSelect.value = savedRegion;
    }
}

// --- Helper: Find an achievement by ID ---
function findAchievement(data, id) {
    return data.achievements.find(a => a.id === id);
}

// --- PKCE & Auth Flow ---
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
    
    const codeVerifier = generateRandomString(64);
    sessionStorage.setItem('code_verifier', codeVerifier);
    
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    const state = generateRandomString(16);
    sessionStorage.setItem('oauth_state', state);

    const authUrl = new URL('https://oauth.battle.net/authorize');
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

    // Restore region immediately so the dropdown doesn't look wrong
    restoreRegion();

    if (code && state) {
        window.history.replaceState({}, document.title, window.location.pathname);

        const savedState = sessionStorage.getItem('oauth_state');
        if (state !== savedState) {
            displayError('Security Error: State mismatch. Please try again.');
            return;
        }

        const codeVerifier = sessionStorage.getItem('code_verifier');
        showLoading();

        try {
            const tokenResponse = await fetch('https://oauth.battle.net/token', {
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
                const errorDetails = await tokenResponse.text();
                throw new Error(`Token Exchange Failed. Status: ${tokenResponse.status}. Details: ${errorDetails}`);
            }

            const tokenData = await tokenResponse.json();
            sessionStorage.setItem('access_token', tokenData.access_token);
            fetchAchievementData();
        } catch (error) {
            console.error('Error:', error);
            // STOP THE FLICKER: Display the error on screen instead of reloading
            displayError(`Login Failed: ${error.message}`);
        }
    } else {
        const accessToken = sessionStorage.getItem('access_token');
        if (accessToken) {
            showLoading();
            fetchAchievementData();
        } else {
            showLogin();
        }
    }
}

// --- Data Fetching ---
async function fetchAchievementData() {
    const accessToken = sessionStorage.getItem('access_token');
    const region = sessionStorage.getItem('selected_region') || 'us'; 
    const apiBaseUrl = `https://${region}.api.blizzard.com`;
    const namespace = `profile-${region}`;

    try {
        const response = await fetch(`${apiBaseUrl}/profile/user/wow/achievements?namespace=${namespace}`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        if (!response.ok) {
            if (response.status === 401) {
                sessionStorage.removeItem('access_token');
                showLogin();
                return;
            }
            if (response.status === 404) {
                 throw new Error('Character/Account data not found. Are you on the right Region?');
            }
            throw new Error(`API Error: ${response.status}`);
        }

        const data = await response.json();
        processLoremasterDeepDive(data);
    } catch (error) {
        console.error('Fetch error:', error);
        displayError(`Data Load Failed: ${error.message}`);
    }
}

// --- Data Processing ---
function processLoremasterDeepDive(data) {
    const loremaster = findAchievement(data, LOREMASTER_ACHIEVEMENT_ID);

    if (!loremaster) {
        displayError("Loremaster achievement data not found in your account.");
        return;
    }

    if (loremaster.is_completed) {
        overallStatus.textContent = "Congratulations! You are The Loremaster!";
        overallProgressBar.style.width = '100%';
        expansionList.innerHTML = '<li class="achievement-item completed">All Done!</li>';
        showResults();
        return;
    }

    const totalCriteria = loremaster.criteria.child_criteria.length;
    const completedCriteria = loremaster.criteria.child_criteria.filter(c => c.is_completed).length;
    const percent = Math.round((completedCriteria / totalCriteria) * 100);
    
    overallStatus.textContent = `Overall Progress: ${percent}%`;
    overallProgressBar.style.width = `${percent}%`;

    renderExpansions(loremaster.criteria.child_criteria, data);
    showResults();
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

        const header = document.createElement('div');
        header.style.width = '100%';
        header.style.display = 'flex';
        header.style.justifyContent = 'space-between';
        header.innerHTML = `<strong>Achievement ID: ${expId}</strong> <span>${expCrit.is_completed ? '✓ Done' : 'In Progress'}</span>`;
        expLi.appendChild(header);

        if (!expCrit.is_completed && expData && expData.criteria) {
            const zoneList = document.createElement('ul');
            zoneList.style.width = '100%';
            zoneList.style.marginTop = '10px';
            zoneList.style.paddingLeft = '20px';
            zoneList.style.fontSize = '0.9em';
            zoneList.style.color = '#ccc';

            const zoneCriteria = expData.criteria.child_criteria || [expData.criteria];

            zoneCriteria.forEach(zoneCrit => {
                if (zoneCrit.is_completed) return; 

                const zoneId = zoneCrit.achievement ? zoneCrit.achievement.id : null;
                if (!zoneId) return;

                const zoneData = findAchievement(allData, zoneId);
                let details = "Not started";

                if (zoneData) {
                    if (zoneData.criteria && zoneData.criteria.amount !== undefined) {
                         const current = zoneData.criteria.amount;
                         const max = zoneData.criteria.max;
                         details = `Progress: ${current} / ${max} Quests`;
                    } 
                    else if (zoneData.criteria && zoneData.criteria.child_criteria) {
                        const missingChapters = zoneData.criteria.child_criteria
                            .filter(c => !c.is_completed)
                            .map(c => c.description || "Unknown Chapter"); 
                        
                        if (missingChapters.length > 0) {
                            details = `Missing Chapters: ${missingChapters.join(', ')}`;
                        }
                    }
                }

                const zoneItem = document.createElement('li');
                zoneItem.style.marginBottom = '5px';
                zoneItem.innerHTML = `Zone ID ${zoneId}: <span style="color:#fff">${details}</span>`;
                zoneList.appendChild(zoneItem);
            });

            expLi.appendChild(zoneList);
        }

        expansionList.appendChild(expLi);
    });
}

// --- UI Handlers ---
function displayError(msg) {
    loginSection.classList.remove('hidden');
    loadingSection.classList.add('hidden');
    resultsSection.classList.add('hidden');
    
    // Inject error message above login button
    let errorDiv = document.getElementById('error-display');
    if (!errorDiv) {
        errorDiv = document.createElement('div');
        errorDiv.id = 'error-display';
        errorDiv.style.color = 'red';
        errorDiv.style.marginBottom = '10px';
        errorDiv.style.fontWeight = 'bold';
        loginSection.insertBefore(errorDiv, loginBtn.parentNode);
    }
    errorDiv.textContent = msg;
}

function showLogin() {
    loginSection.classList.remove('hidden');
    loadingSection.classList.add('hidden');
    resultsSection.classList.add('hidden');
}
function showLoading() {
    loginSection.classList.add('hidden');
    loadingSection.classList.remove('hidden');
    resultsSection.classList.add('hidden');
}
function showResults() {
    loginSection.classList.add('hidden');
    loadingSection.classList.add('hidden');
    resultsSection.classList.remove('hidden');
}
function logout() {
    sessionStorage.clear();
    window.location.href = window.location.pathname;
}

// --- Event Listeners ---
loginBtn.addEventListener('click', initiateLogin);
if(logoutBtn) logoutBtn.addEventListener('click', logout);
regionSelect.addEventListener('change', () => {
    // Save region instantly when changed, just in case
    sessionStorage.setItem('selected_region', regionSelect.value);
});

// Run on page load
handleCallback();
