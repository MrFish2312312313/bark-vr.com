/* ============================================================================
   BARK — Developer Panel CloudScript
   Title ID: 7BB14

   DEPLOYMENT (one-time, then again whenever you change DEV_EMAILS):
     1. Paste your PlayFab developer secret into TITLE_SECRET_KEY below
        (https://developer.playfab.com/en-US/7BB14/settings/secret-keys).
        This file lives on PlayFab's servers only — it is NEVER sent to
        browsers. The website calls these handlers via ExecuteCloudScript.
     2. Open https://developer.playfab.com/en-US/7BB14/automation/cloud-script/revisions
     3. Click "Upload New Revision"
     4. Paste the entire contents of this file
     5. Click "Save as Revision" then "Deploy"
     6. Confirm "Currently Deployed Revision" updated

   HOW IT WORKS (security model):
     The website signs the dev into PlayFab as any regular player (Custom ID
     login) and calls these handlers via ExecuteCloudScript. Every handler
     re-validates the caller's Google ID token by hitting Google's official
     tokeninfo endpoint from inside CloudScript. The token must:
       - have aud == GOOGLE_CLIENT_ID
       - be email_verified
       - belong to an email in DEV_EMAILS
       - not be expired
     Because the token check runs server-side and pulls the email straight
     from Google, the caller cannot spoof their identity by editing browser
     JS or stealing a session ticket. The PlayFab developer secret key is
     never exposed to the browser.
   ============================================================================ */

// 🍍 (one of these is hidden in every dev-panel file)

// PASTE YOUR DEV SECRET HERE. Found at:
//   https://developer.playfab.com/en-US/7BB14/settings/secret-keys
// Needed because looking up a player by display name requires the Admin API,
// which CloudScript Classic accesses via HTTP with the secret key in the header.
var TITLE_SECRET_KEY = 'REPLACE_WITH_YOUR_PLAYFAB_DEV_SECRET';
var TITLE_ID         = '7BB14';

var GOOGLE_CLIENT_ID = '30694987707-f9vq4vafl2s4bpli7jr3lap98jskbcjq.apps.googleusercontent.com';

var DEV_EMAILS = [
    'mrfeesh456@gmail.com'
    // add more dev emails here, comma-separated, lowercase
];

// ---------- Helpers ----------

function lower(s) { return String(s || '').toLowerCase(); }

function isDevEmail(email) {
    var e = lower(email);
    for (var i = 0; i < DEV_EMAILS.length; i++) {
        if (lower(DEV_EMAILS[i]) === e) return true;
    }
    return false;
}

function verifyDevToken(idToken) {
    if (!idToken) return { ok: false, error: 'Missing idToken' };
    var url = 'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken);
    var raw;
    try {
        raw = http.request(url, 'get', null, 'application/json', null);
    } catch (e) {
        return { ok: false, error: 'tokeninfo HTTP failed: ' + (e.message || e) };
    }
    var parsed;
    try { parsed = JSON.parse(raw); }
    catch (e) { return { ok: false, error: 'tokeninfo returned non-JSON' }; }

    if (parsed.error_description) return { ok: false, error: 'Google: ' + parsed.error_description };
    if (parsed.aud !== GOOGLE_CLIENT_ID) return { ok: false, error: 'Wrong Google audience' };
    var verified = parsed.email_verified;
    if (verified !== true && verified !== 'true') return { ok: false, error: 'Email not verified' };

    var exp = parseInt(parsed.exp, 10);
    if (exp && (exp * 1000) < Date.now()) return { ok: false, error: 'Google token expired' };

    var email = lower(parsed.email);
    if (!email) return { ok: false, error: 'No email in token' };
    if (!isDevEmail(email)) return { ok: false, error: 'Not authorized: ' + email };

    return { ok: true, email: email };
}

function apiErr(e) {
    if (!e) return 'Unknown error';
    if (e.apiErrorInfo && e.apiErrorInfo.apiError) {
        var a = e.apiErrorInfo.apiError;
        return (a.errorMessage || a.error || JSON.stringify(a));
    }
    return e.message || String(e);
}

// Call any PlayFab Admin API endpoint via HTTP. Server API methods are
// exposed on the global `server` object, but Admin-only methods (we need
// GetUserAccountInfo for display-name lookup) aren't — so we hit REST.
function adminCall(endpoint, body) {
    if (!TITLE_SECRET_KEY || TITLE_SECRET_KEY === 'REPLACE_WITH_YOUR_PLAYFAB_DEV_SECRET') {
        throw { message: 'TITLE_SECRET_KEY not set in CloudScript — paste your PlayFab developer secret into dev-cloudscript.js and redeploy' };
    }
    var url = 'https://' + TITLE_ID + '.playfabapi.com/Admin/' + endpoint;
    var raw = http.request(url, 'post', JSON.stringify(body || {}), 'application/json', {
        'X-SecretKey': TITLE_SECRET_KEY
    });
    var parsed;
    try { parsed = JSON.parse(raw); }
    catch (e) { throw { message: 'Admin/' + endpoint + ' returned non-JSON' }; }
    if (parsed.code !== 200 || !parsed.data) {
        throw { message: 'Admin/' + endpoint + ': ' + (parsed.errorMessage || parsed.error || ('HTTP ' + parsed.code)) };
    }
    return parsed.data;
}

// Resolve one display name to a PlayFabId via Admin/GetUserAccountInfo.
// Returns null if no match.
function resolveDisplayName(displayName) {
    if (!displayName) return null;
    try {
        var r = adminCall('GetUserAccountInfo', { TitleDisplayName: displayName });
        return (r.UserInfo && r.UserInfo.PlayFabId) || null;
    } catch (e) {
        // PlayFab returns 404-style when display name doesn't match — treat as null
        return null;
    }
}

// ---------- Handlers ----------

handlers.DevPing = function (args, context) {
    var auth = verifyDevToken(args && args.idToken);
    return { success: auth.ok, email: auth.email || null, error: auth.error || null };
};

// Single-name resolver. Use this from the frontend when the dev clicks a
// player — much cheaper and faster than batch.
handlers.DevResolvePlayer = function (args, context) {
    var auth = verifyDevToken(args && args.idToken);
    if (!auth.ok) return { success: false, error: auth.error };
    if (!args.displayName) return { success: false, error: 'Missing displayName' };

    try {
        var pfId = resolveDisplayName(args.displayName);
        return { success: true, displayName: args.displayName, playFabId: pfId };
    } catch (e) {
        return { success: false, error: apiErr(e) };
    }
};

// Batch resolver — iterates display names through Admin/GetUserAccountInfo.
// Caps at 20 per call to stay well under CloudScript's 30s timeout.
handlers.DevResolvePlayers = function (args, context) {
    var auth = verifyDevToken(args && args.idToken);
    if (!auth.ok) return { success: false, error: auth.error };

    var names = (args && args.displayNames) || [];
    if (!names.length) return { success: true, mapping: {} };
    if (names.length > 20) names = names.slice(0, 20);

    var mapping = {};
    try {
        for (var i = 0; i < names.length; i++) {
            var pf = resolveDisplayName(names[i]);
            if (pf) mapping[names[i]] = pf;
        }
        return { success: true, mapping: mapping };
    } catch (e) {
        return { success: false, error: apiErr(e) };
    }
};

handlers.DevGetInventory = function (args, context) {
    var auth = verifyDevToken(args && args.idToken);
    if (!auth.ok) return { success: false, error: auth.error };
    if (!args.playfabId) return { success: false, error: 'Missing playfabId' };

    try {
        var inv = server.GetUserInventory({ PlayFabId: args.playfabId });
        var items = (inv.Inventory || []).map(function (it) {
            return {
                itemId: it.ItemId,
                itemInstanceId: it.ItemInstanceId,
                displayName: it.DisplayName || it.ItemId,
                remainingUses: it.RemainingUses != null ? it.RemainingUses : null
            };
        });
        return {
            success: true,
            items: items,
            virtualCurrency: inv.VirtualCurrency || {}
        };
    } catch (e) {
        return { success: false, error: apiErr(e) };
    }
};

handlers.DevGetCatalog = function (args, context) {
    var auth = verifyDevToken(args && args.idToken);
    if (!auth.ok) return { success: false, error: auth.error };

    try {
        var r = server.GetCatalogItems({
            CatalogVersion: (args && args.catalogVersion) || null
        });
        var items = (r.Catalog || []).map(function (c) {
            return {
                itemId: c.ItemId,
                displayName: c.DisplayName || c.ItemId,
                itemClass: c.ItemClass || ''
            };
        });
        return { success: true, items: items };
    } catch (e) {
        return { success: false, error: apiErr(e) };
    }
};

handlers.DevGiveItem = function (args, context) {
    var auth = verifyDevToken(args && args.idToken);
    if (!auth.ok) return { success: false, error: auth.error };
    if (!args.playfabId || !args.itemId) {
        return { success: false, error: 'Missing playfabId or itemId' };
    }

    var qty = parseInt(args.quantity, 10);
    if (!qty || qty < 1) qty = 1;
    if (qty > 100) return { success: false, error: 'Quantity capped at 100' };

    var ids = [];
    for (var i = 0; i < qty; i++) ids.push(args.itemId);

    try {
        var r = server.GrantItemsToUser({
            PlayFabId: args.playfabId,
            ItemIds: ids,
            CatalogVersion: args.catalogVersion || null
        });
        return {
            success: true,
            by: auth.email,
            granted: (r.ItemGrantResults || []).map(function (g) {
                return { itemId: g.ItemId, itemInstanceId: g.ItemInstanceId };
            })
        };
    } catch (e) {
        return { success: false, error: apiErr(e) };
    }
};

handlers.DevRevokeItem = function (args, context) {
    var auth = verifyDevToken(args && args.idToken);
    if (!auth.ok) return { success: false, error: auth.error };
    if (!args.playfabId || !args.itemInstanceId) {
        return { success: false, error: 'Missing playfabId or itemInstanceId' };
    }

    try {
        server.RevokeInventoryItem({
            PlayFabId: args.playfabId,
            ItemInstanceId: args.itemInstanceId
        });
        return { success: true, by: auth.email };
    } catch (e) {
        return { success: false, error: apiErr(e) };
    }
};

// amount may be negative to subtract
handlers.DevAddCurrency = function (args, context) {
    var auth = verifyDevToken(args && args.idToken);
    if (!auth.ok) return { success: false, error: auth.error };
    if (!args.playfabId || !args.currencyCode) {
        return { success: false, error: 'Missing playfabId or currencyCode' };
    }
    var amount = parseInt(args.amount, 10);
    if (!amount || isNaN(amount)) return { success: false, error: 'Amount must be a non-zero integer' };

    try {
        var balance;
        if (amount > 0) {
            var r = server.AddUserVirtualCurrency({
                PlayFabId: args.playfabId,
                VirtualCurrency: args.currencyCode,
                Amount: amount
            });
            balance = r.Balance;
        } else {
            var r2 = server.SubtractUserVirtualCurrency({
                PlayFabId: args.playfabId,
                VirtualCurrency: args.currencyCode,
                Amount: -amount
            });
            balance = r2.Balance;
        }
        return { success: true, by: auth.email, balance: balance };
    } catch (e) {
        return { success: false, error: apiErr(e) };
    }
};

// Set the balance to an exact value (computes diff vs current).
handlers.DevSetCurrencyTo = function (args, context) {
    var auth = verifyDevToken(args && args.idToken);
    if (!auth.ok) return { success: false, error: auth.error };
    if (!args.playfabId || !args.currencyCode) {
        return { success: false, error: 'Missing playfabId or currencyCode' };
    }
    var target = parseInt(args.target, 10);
    if (isNaN(target) || target < 0) return { success: false, error: 'Target must be a non-negative integer' };

    try {
        var inv = server.GetUserInventory({ PlayFabId: args.playfabId });
        var current = (inv.VirtualCurrency && inv.VirtualCurrency[args.currencyCode]) || 0;
        var diff = target - current;
        if (diff === 0) return { success: true, by: auth.email, balance: current, noChange: true };

        var balance;
        if (diff > 0) {
            var r = server.AddUserVirtualCurrency({
                PlayFabId: args.playfabId,
                VirtualCurrency: args.currencyCode,
                Amount: diff
            });
            balance = r.Balance;
        } else {
            var r2 = server.SubtractUserVirtualCurrency({
                PlayFabId: args.playfabId,
                VirtualCurrency: args.currencyCode,
                Amount: -diff
            });
            balance = r2.Balance;
        }
        return { success: true, by: auth.email, balance: balance };
    } catch (e) {
        return { success: false, error: apiErr(e) };
    }
};

handlers.DevSetWood = function (args, context) {
    var auth = verifyDevToken(args && args.idToken);
    if (!auth.ok) return { success: false, error: auth.error };
    if (!args.playfabId || !args.woodId) {
        return { success: false, error: 'Missing playfabId or woodId' };
    }

    try {
        // The game stores woodID in UserData (client-writable, key "woodID").
        server.UpdateUserData({
            PlayFabId: args.playfabId,
            Data: { woodID: String(args.woodId) },
            Permission: 'Public'
        });
        return { success: true, by: auth.email, woodID: String(args.woodId) };
    } catch (e) {
        return { success: false, error: apiErr(e) };
    }
};
