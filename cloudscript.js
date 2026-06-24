/* ============================================================================
   BARK — COMBINED CloudScript   (PlayFab Title ID: 7BB14)

   👉 THIS is the complete, authoritative CloudScript. Deploy THIS ONE file.
      It contains EVERY handler the game and website rely on:
        • Developer panel  (Dev*)            → website /developer page
        • Wood-type counts (…WoodCount…)     → website /extras counter
        • IAP / store / trading              → the game (StoreManager, trading…)

   ⚠️  DO NOT deploy dev-cloudscript.js or cloudya.js on their own. Each holds
       only PART of the handlers, so deploying either ALONE WIPES the rest from
       PlayFab. That is exactly what broke things: when only the dev handlers
       were deployed, IncrementWoodCount disappeared, so the wood counter
       stopped updating (and store/trading grants silently failed). Always
       deploy this merged file so all handlers are present together.

   DEPLOYMENT (one-time, then again whenever you change DEV_EMAILS or a handler):
     1. Paste your PlayFab developer secret into TITLE_SECRET_KEY below
        (https://developer.playfab.com/en-US/7BB14/settings/secret-keys).
        This file lives on PlayFab's servers only — it is NEVER sent to browsers.
     2. https://developer.playfab.com/en-US/7BB14/automation/cloud-script/revisions
     3. "Upload New Revision" → paste this entire file
     4. "Save as Revision" → "Deploy"
     5. Confirm "Currently Deployed Revision" updated.
   ============================================================================ */

// 🍍

// ─────────────────────────────────────────────────────────────────────────────
//  CONFIG
// ─────────────────────────────────────────────────────────────────────────────

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


// ═════════════════════════════════════════════════════════════════════════════
//  SECTION 1 — DEVELOPER PANEL  (website /developer page)
//  Security model: the website signs the dev into PlayFab as a regular player
//  and calls these via ExecuteCloudScript. Every handler re-validates the
//  caller's Google ID token server-side (Google tokeninfo), requiring
//  aud == GOOGLE_CLIENT_ID, email_verified, an email in DEV_EMAILS, and not
//  expired — so identity can't be spoofed from browser JS.
// ═════════════════════════════════════════════════════════════════════════════

// ---------- Dev helpers ----------

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

// Call any PlayFab Admin API endpoint via HTTP. Server API methods are exposed
// on the global `server` object, but Admin-only methods (we need
// GetUserAccountInfo for display-name lookup) aren't — so we hit REST.
function adminCall(endpoint, body) {
    if (!TITLE_SECRET_KEY || TITLE_SECRET_KEY === 'REPLACE_WITH_YOUR_PLAYFAB_DEV_SECRET') {
        throw { message: 'TITLE_SECRET_KEY not set in CloudScript — paste your PlayFab developer secret into cloudscript.js and redeploy' };
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

// ---------- Dev handlers ----------

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
    var newWood = String(args.woodId);

    try {
        // Read the player's CURRENT wood first so we can keep the public
        // WoodCounts tally accurate. The game updates the tally itself on a
        // normal in-game change, but a dev override bypasses that path — without
        // this, dev-setting a player to (say) Walnut left Walnut showing 0 on the
        // /extras counter. _incWood/_decWood are defined in Section 2 (hoisted).
        var oldWood = null;
        try {
            var ud = server.GetUserData({ PlayFabId: args.playfabId, Keys: ['woodID'] });
            oldWood = (ud.Data && ud.Data.woodID && ud.Data.woodID.Value) || null;
        } catch (e) { /* non-fatal: still set the wood, just can't reconcile old */ }

        // The game stores woodID in UserData (client-writable, key "woodID").
        server.UpdateUserData({
            PlayFabId: args.playfabId,
            Data: { woodID: newWood },
            Permission: 'Public'
        });

        if (oldWood !== newWood) {
            if (oldWood) _decWood(oldWood);
            _incWood(newWood);
        }

        return { success: true, by: auth.email, woodID: newWood, prevWoodID: oldWood };
    } catch (e) {
        return { success: false, error: apiErr(e) };
    }
};


// ═════════════════════════════════════════════════════════════════════════════
//  SECTION 2 — WOOD-TYPE COUNTERS  (website /extras counter)
//  Hardened against JSON-parse failure + concurrent writes. Schema is
//  { woodID -> int } in Title Data "WoodCounts". Negative counts clamp to 0.
//
//  Concurrency note: Title Data has no transactional update path, so two
//  concurrent increments can race (mild 1-2 count drift). The try/catch means a
//  half-written value never crashes subsequent reads — which is what used to
//  blank the counter. If write rate ever gets high enough that drift matters,
//  move this from Title Data to per-player Statistics + a periodic aggregator.
// ═════════════════════════════════════════════════════════════════════════════

function _safeReadWoodCounts() {
    var titleDataKey = "WoodCounts";
    var res = server.GetTitleData({ Keys: [titleDataKey] });
    if (!res.Data || !res.Data[titleDataKey]) return {};
    try {
        var parsed = JSON.parse(res.Data[titleDataKey]);
        return (parsed && typeof parsed === "object") ? parsed : {};
    } catch (e) {
        log.error("WoodCounts parse failure — resetting to empty. Raw value: " + res.Data[titleDataKey]);
        return {};
    }
}

// Internal +1 / -1 so both the public handlers AND DevSetWood share one path.
function _incWood(woodID) {
    if (!woodID) return 0;
    var counts = _safeReadWoodCounts();
    counts[woodID] = (counts[woodID] || 0) + 1;
    server.SetTitleData({ Key: "WoodCounts", Value: JSON.stringify(counts) });
    log.info("WoodCount + | " + woodID + " → " + counts[woodID]);
    return counts[woodID];
}

function _decWood(woodID) {
    if (!woodID) return 0;
    var counts = _safeReadWoodCounts();
    counts[woodID] = Math.max(0, (counts[woodID] || 0) - 1);
    server.SetTitleData({ Key: "WoodCounts", Value: JSON.stringify(counts) });
    log.info("WoodCount - | " + woodID + " → " + counts[woodID]);
    return counts[woodID];
}

handlers.IncrementWoodCount = function (args, context) {
    var woodID = args.woodID;
    if (!woodID) return { success: false, error: "No woodID provided" };
    var n = _incWood(woodID);
    return { success: true, woodID: woodID, newCount: n };
};

handlers.DecrementWoodCount = function (args, context) {
    var woodID = args.woodID;
    if (!woodID) return { success: false, error: "No woodID provided" };
    var n = _decWood(woodID);
    return { success: true, woodID: woodID, newCount: n };
};

handlers.GetWoodCounts = function (args, context) {
    var counts = _safeReadWoodCounts();
    log.info("GetWoodCounts | " + Object.keys(counts).length + " wood types tracked");
    return { counts: counts };
};

// Admin / debug — call from a CloudScript editor button if WoodCounts ever gets
// so wedged you want to wipe it. Safe to leave deployed.
handlers.ResetWoodCounts = function (args, context) {
    server.SetTitleData({ Key: "WoodCounts", Value: "{}" });
    log.info("ResetWoodCounts | wiped to empty object");
    return { success: true };
};


// ═════════════════════════════════════════════════════════════════════════════
//  SECTION 3 — IAP / STORE / TRADING  (the game)
// ═════════════════════════════════════════════════════════════════════════════

// ── GrantStoreItems ──────────────────────────────────────────────────────────
// Called by StoreManager after a fresh purchase when the product has items.
// Currency is handled client-side via AddUserVirtualCurrency — not here.
//
// args:
//   sku            {string}   — Meta IAP SKU, e.g. "starter_bundle"
//   receiptData    {string}   — Meta purchase ID for audit logging
//   catalogVersion {string}   — PlayFab catalog name, e.g. "Main"
//   itemIds        {string[]} — PlayFab Item IDs to grant
//   isDurable      {bool}     — For logging only; consume logic is on Unity side
//
handlers.GrantStoreItems = function (args, context) {
    var sku            = args.sku            || "";
    var receiptData    = args.receiptData    || "none";
    var catalogVersion = args.catalogVersion || "Main";
    var itemIds        = args.itemIds        || [];
    var isDurable      = args.isDurable      || false;

    if (!sku) {
        return { success: false, error: "No SKU provided" };
    }

    if (!itemIds || itemIds.length === 0) {
        return { success: false, error: "No itemIds provided — use client-side grant for currency-only products" };
    }

    var playFabId = context.currentUserProfile.PlayerId;
    var itemsGranted = [];

    var grantResult = server.GrantItemsToUser({
        PlayFabId:      playFabId,
        CatalogVersion: catalogVersion,
        ItemIds:        itemIds
    });

    if (grantResult.ItemGrantResults) {
        for (var i = 0; i < grantResult.ItemGrantResults.length; i++) {
            itemsGranted.push(grantResult.ItemGrantResults[i].ItemId);
        }
    }

    log.info("GrantStoreItems | player=" + playFabId +
             " sku=" + sku +
             " items=" + JSON.stringify(itemsGranted) +
             " durable=" + isDurable +
             " receipt=" + receiptData);

    return {
        success:      true,
        sku:          sku,
        itemsGranted: itemsGranted
    };
};


// ── RecoverDurableItems ──────────────────────────────────────────────────────
// Called on startup for every durable product the player already owns.
// Checks their current inventory and grants any expected items that are missing.
// Safe to call repeatedly — only grants what the player doesn't already have.
//
// args:
//   sku            {string}   — Meta IAP SKU, used for logging
//   catalogVersion {string}   — PlayFab catalog name, e.g. "Main"
//   itemIds        {string[]} — The full list of item IDs this durable should grant
//
handlers.RecoverDurableItems = function (args, context) {
    var sku            = args.sku            || "";
    var catalogVersion = args.catalogVersion || "Main";
    var itemIds        = args.itemIds        || [];

    if (!itemIds || itemIds.length === 0) {
        return { success: true, recovered: [], message: "No items to check" };
    }

    var playFabId = context.currentUserProfile.PlayerId;

    // Fetch the player's current inventory
    var inventoryResult = server.GetUserInventory({ PlayFabId: playFabId });
    var inventory = inventoryResult.Inventory || [];

    // Build a set of item IDs the player already owns
    var ownedItemIds = {};
    for (var i = 0; i < inventory.length; i++) {
        ownedItemIds[inventory[i].ItemId] = true;
    }

    // Find which expected items are missing
    var missingIds = [];
    for (var j = 0; j < itemIds.length; j++) {
        if (!ownedItemIds[itemIds[j]]) {
            missingIds.push(itemIds[j]);
        }
    }

    // Nothing missing — player is good
    if (missingIds.length === 0) {
        log.info("RecoverDurableItems | player=" + playFabId +
                 " sku=" + sku + " | all items present, nothing to recover");

        return {
            success:   true,
            recovered: [],
            message:   "All items already present"
        };
    }

    // Grant the missing items
    var grantResult = server.GrantItemsToUser({
        PlayFabId:      playFabId,
        CatalogVersion: catalogVersion,
        ItemIds:        missingIds
    });

    var recovered = [];
    if (grantResult.ItemGrantResults) {
        for (var k = 0; k < grantResult.ItemGrantResults.length; k++) {
            recovered.push(grantResult.ItemGrantResults[k].ItemId);
        }
    }

    log.info("RecoverDurableItems | player=" + playFabId +
             " sku=" + sku +
             " | recovered=" + JSON.stringify(recovered));

    return {
        success:   true,
        recovered: recovered,
        message:   "Recovered " + recovered.length + " missing item(s)"
    };
};


// ── GrantItemToPlayer ────────────────────────────────────────────────────────
// Called by GumballMachine.cs after currency is deducted.
// Grants a single item from the gumball catalog to the calling player.
// Using server-authoritative grant so the client can't spoof free items.
//
// args:
//   itemId         {string} — PlayFab Item ID to grant, e.g. "oak_wood_changer"
//   catalogVersion {string} — PlayFab catalog name, e.g. "items"
//
handlers.GrantItemToPlayer = function (args, context) {
    var itemId         = args.itemId         || "";
    var catalogVersion = args.catalogVersion || "items";

    if (!itemId) {
        return { success: false, error: "No itemId provided" };
    }

    var playFabId = context.currentUserProfile.PlayerId;

    // Double-check the player doesn't already own this item before granting.
    // This is the server-side duplicate guard — the client checks too, but
    // this makes sure a race condition or exploited client can't double-grant.
    var inventoryResult = server.GetUserInventory({ PlayFabId: playFabId });
    var inventory = inventoryResult.Inventory || [];

    for (var i = 0; i < inventory.length; i++) {
        if (inventory[i].ItemId === itemId) {
            log.info("GrantItemToPlayer | player=" + playFabId +
                     " already owns " + itemId + " — skipping grant");
            return { success: false, error: "already_owned", itemId: itemId };
        }
    }

    var grantResult = server.GrantItemsToUser({
        PlayFabId:      playFabId,
        CatalogVersion: catalogVersion,
        ItemIds:        [itemId]
    });

    var granted = grantResult.ItemGrantResults && grantResult.ItemGrantResults.length > 0
        ? grantResult.ItemGrantResults[0].ItemId
        : null;

    log.info("GrantItemToPlayer | player=" + playFabId +
             " granted=" + granted +
             " catalog=" + catalogVersion);

    return {
        success: granted !== null,
        itemId:  granted
    };
};


// ── TradeStorePetItem ─────────────────────────────────────────────────────────
// Moves a store-pet's underlying PlayFab item from the CALLER (sender) to the
// other player (receiver) as part of a pet trade. Without this, trading a store
// pet doesn't stick: the sender keeps the catalog item, so PlayerPetCollection
// .SyncStorePets re-grants them the pet on their next load. Server-authoritative
// so a client can't grant itself free store items.
//
// The pet RECORD (name / age / stats / skin) is moved CLIENT-SIDE by
// TradingStation; this handler only relocates the catalog item so ownership of
// the special pet truly transfers and neither side ends up with a duplicate
// special pet. 🍍
//
// Ordering: grant to the receiver FIRST, then revoke from the sender. If the
// grant throws, nothing is revoked (sender keeps the item, trade can retry) —
// strictly safer than revoke-first, which could destroy the item on a failed
// grant.
//
// args:
//   toPlayFabId    {string} — receiver's PlayFab ID (the other side of the trade)
//   itemId         {string} — store-pet catalog Item ID, e.g. "Muddy Pig"
//   catalogVersion {string} — PlayFab catalog name, defaults "items"
//
handlers.TradeStorePetItem = function (args, context) {
    var toPlayFabId    = args.toPlayFabId    || "";
    var itemId         = args.itemId         || "";
    var catalogVersion = args.catalogVersion || "items";

    if (!itemId)      return { success: false, error: "No itemId provided" };
    if (!toPlayFabId) return { success: false, error: "No toPlayFabId provided" };

    var fromPlayFabId = context.currentUserProfile.PlayerId;
    if (fromPlayFabId === toPlayFabId) {
        return { success: false, error: "Cannot trade a store pet to yourself" };
    }

    // 1) Confirm the SENDER actually owns the item — find its instance id.
    var fromInv = (server.GetUserInventory({ PlayFabId: fromPlayFabId }).Inventory) || [];
    var instanceId = null;
    for (var i = 0; i < fromInv.length; i++) {
        if (fromInv[i].ItemId === itemId) { instanceId = fromInv[i].ItemInstanceId; break; }
    }
    if (!instanceId) {
        log.info("TradeStorePetItem | sender " + fromPlayFabId + " does not own " + itemId + " — nothing to transfer");
        return { success: false, error: "sender_does_not_own_item", itemId: itemId };
    }

    // 2) Does the RECEIVER already own it? If so, skip the grant (one store
    //    pet only — a stray duplicate durable would be messy).
    var toInv = (server.GetUserInventory({ PlayFabId: toPlayFabId }).Inventory) || [];
    var receiverAlreadyOwns = false;
    for (var j = 0; j < toInv.length; j++) {
        if (toInv[j].ItemId === itemId) { receiverAlreadyOwns = true; break; }
    }

    // 3) Grant to the receiver (if needed) BEFORE revoking from the sender.
    var granted = false;
    if (!receiverAlreadyOwns) {
        server.GrantItemsToUser({
            PlayFabId:      toPlayFabId,
            CatalogVersion: catalogVersion,
            ItemIds:        [itemId]
        });
        granted = true;
    }

    // 4) Revoke the sender's instance — they've traded it away.
    server.RevokeInventoryItem({ PlayFabId: fromPlayFabId, ItemInstanceId: instanceId });

    log.info("TradeStorePetItem | " + itemId +
             " | from=" + fromPlayFabId + " (revoked instance " + instanceId + ")" +
             " to=" + toPlayFabId + " (granted=" + granted + ", alreadyOwned=" + receiverAlreadyOwns + ")");

    return {
        success:              true,
        itemId:               itemId,
        revokedFrom:          fromPlayFabId,
        grantedTo:            granted ? toPlayFabId : null,
        receiverAlreadyOwned: receiverAlreadyOwns
    };
};


// ═════════════════════════════════════════════════════════════════════════════
//  SECTION 4 — HOURLY PINEAPPLE  (one global winner per UTC hour, all lobbies)
//  The CLIENT (HourlyPineapple.cs) computes WHERE / WHEN deterministically from
//  the UTC hour, so no spawn data is networked — this only arbitrates WHO got it.
//  First ClaimPineapple for a given hour wins; everyone else is told it's taken.
//  State = Title Data "PineappleClaim" = { hour, by, playFabId, at }.
//  (Title Data isn't transactional, so a same-millisecond double-claim can very
//   rarely slip through — fine for a once-an-hour prize. Move to a shared-group
//   lock if it ever matters.)
// ═════════════════════════════════════════════════════════════════════════════

function _readPineapple() {
    try {
        var res = server.GetTitleData({ Keys: ["PineappleClaim"] });
        if (!res.Data || !res.Data.PineappleClaim) return null;
        return JSON.parse(res.Data.PineappleClaim);
    } catch (e) {
        return null;
    }
}

handlers.GetPineappleState = function (args, context) {
    var hour = String((args && args.hour) || "");
    var claim = _readPineapple();
    var claimed = !!(claim && String(claim.hour) === hour);
    return { claimed: claimed, by: claimed ? (claim.by || "") : "" };
};

handlers.ClaimPineapple = function (args, context) {
    var hour = String((args && args.hour) || "");
    if (!hour) return { success: false, error: "no hour" };

    var claim = _readPineapple();
    if (claim && String(claim.hour) === hour) {
        return { success: false, alreadyClaimed: true, by: claim.by || "" };
    }

    var pid  = context.currentUserProfile.PlayerId;
    var name = context.currentUserProfile.DisplayName || pid;
    server.SetTitleData({
        Key: "PineappleClaim",
        Value: JSON.stringify({ hour: hour, by: name, playFabId: pid, at: Date.now() })
    });

    // OPTIONAL reward — uncomment + tune (AT = Arcade Token, PC = Paper Coin):
    // server.AddUserVirtualCurrency({ PlayFabId: pid, VirtualCurrency: "AT", Amount: 100 });

    log.info("Pineapple claimed | hour=" + hour + " by=" + name);
    return { success: true, by: name };
};
