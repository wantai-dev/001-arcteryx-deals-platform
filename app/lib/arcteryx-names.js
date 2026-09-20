/*
 * Canonical Arc'teryx product-name runtime for GearDrop web and App.
 *
 * This root file is the source of truth. Run
 *   python3 tools/sync_arcteryx_names.py
 * after editing it so the Expo copy stays byte-for-byte identical.
 */
(function initArcTeryxNames(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.ArcTeryxNames = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createArcTeryxNames() {
    'use strict';

    // Union of the production catalog's active model families (2026-08-09)
    // and the existing GearDrop historical family registry. New families must
    // be added deliberately; unknown names are preserved and surfaced by the
    // audit instead of being truncated by a generic heuristic.
    const MODEL_FAMILIES = Object.freeze([
        'Acrux', 'Aerios', 'Aestas', 'Align', 'Alpine', 'Alpha', 'Altus', 'Andessa',
        "Arc'Word", 'AR-385a', 'AR-395a', 'Argand', 'Arris', 'Arro', 'Asset', 'Atom', 'Axios', 'Belfry', 'Beta',
        'Bird', 'Blade', 'Bora', 'Brize', 'Bucket', 'Calidum', 'Carrier', 'Centroid', 'Cerium',
        'Clarkia', 'Chunky', 'Coelle', 'Color', 'Colour', 'Conduit', 'Conic', 'Conveyor', 'Corbel', 'Cormac',
        'Covert', 'Cranbrook', 'Creston', 'Cronin', 'Cusec', 'Decca', 'Delta', 'Demlo', 'Dias',
        'Diantric', 'Diene', 'Diode', 'Dromos', 'Eave', 'Elec', 'Emaris', 'Emblem', 'Entasis', 'Essent',
        'Field', 'Fissile', 'Fission', 'Focal', 'Frame', 'Gamma', 'Granville', 'Grotto',
        'Hadron', 'Hallam', 'Heliad', 'Icosa', 'Ifora', 'Incendia', 'Incendo', 'Index',
        'Indisce', 'Ion', 'Ionia', 'Isogon', 'Kappa', 'Khara', 'Khard', 'Kopec', 'Konseal',
        'Kragg', 'Kraft', 'Kyanite', 'Lana', 'Lerus', 'Levon', 'Liatris', 'Limina',
        'Lithos', 'Lota', 'Macai', 'Mallow', 'Mantis', 'Metry', 'Metron', 'Micon', 'Mionn',
        'Monitor', 'Motus', 'Naya', 'Nia', 'Nitra', 'Norvan', 'Nuclei', 'Ogee',
        'Olera', 'Olia', 'Oloss', 'Orsin', 'Ossa', 'Palisade', 'Palister', 'Patera', 'Phasic',
        'Practitioner', 'Performance', 'Proton', 'Psiphon', 'Quartic', 'Quintic', 'Ralle', 'Rescue', 'Rho', 'Rhoam',
        'Rhomb', 'Ribbed', 'Rula', 'Rush', 'Sabre', 'Satoro', 'Sawyer', 'Saydi',
        'Secant', 'Sentinel', 'Serratus', 'Sigma', 'Silex', 'Silene', 'Sima', 'Sinsola',
        'Sinsolo', 'Skaha', 'Ski', 'Skyline', 'Solano', 'Sonii', 'Soria', 'Sorin',
        'Synthetic',
        'Spere', 'Squamish', 'Sunna', 'Sylan', 'Taema', 'Therme', 'Theta', 'Thorium',
        'Toric', 'Veilance', 'Venta', 'Verro', 'Vertex', 'Voronoi', 'Word', 'Zeta',
    ]);

    const BRAND_PREFIX = /^arc(?:[\s-]*[’'`]?teryx)\s+/i;
    const KNOWN_TOKEN_CASE = Object.freeze([
        [/\barc[’']?word\b/gi, "Arc'Word"],
        [/\bAR[\s-]+(385a|395a)\b/gi, 'AR-$1'],
        [/\blitric\b/gi, 'LiTRIC'],
        [/\bsuperlight\b/gi, 'SuperLight'],
        [/\bstormhood\b/gi, 'StormHood'],
        [/\bdownword\b/gi, 'DownWord'],
    ]);
    const GENDER_PATTERNS = Object.freeze([
        { label: "Women's", pattern: /\b(?:women(?:[’']?s)?|woman|damen|femme)\b/i },
        { label: "Men's", pattern: /\b(?:men(?:[’']?s)?|man|herren|homme)\b/i },
        { label: 'Unisex', pattern: /\bunisex\b/i },
    ]);

    const FAMILY_BY_KEY = new Map(MODEL_FAMILIES.map((family) => [family.toLowerCase(), family]));
    const FAMILY_MATCHERS = MODEL_FAMILIES
        .slice()
        .sort((a, b) => b.length - a.length)
        .map((family) => ({
            family,
            pattern: new RegExp(`(^|\\s)(${family.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?=\\s|$)`, 'i'),
        }));

    function normalizeWhitespace(value) {
        return String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
    }

    function normalizeKnownTokenCase(value) {
        let normalized = value;
        for (const [pattern, replacement] of KNOWN_TOKEN_CASE) {
            normalized = normalized.replace(pattern, replacement);
        }
        return normalized;
    }

    function normalizeGender(value) {
        const key = String(value || '').trim().toLowerCase().replace(/[’']/g, '');
        if (['women', 'womens', 'woman', 'female', 'damen', 'femme'].includes(key)) return "Women's";
        if (['men', 'mens', 'man', 'male', 'herren', 'homme'].includes(key)) return "Men's";
        if (key === 'unisex') return 'Unisex';
        return '';
    }

    function findFamilyMatch(value) {
        let best = null;
        for (const candidate of FAMILY_MATCHERS) {
            const match = candidate.pattern.exec(value);
            if (!match) continue;
            const index = match.index + match[1].length;
            if (!best || index < best.index || (index === best.index && candidate.family.length > best.family.length)) {
                best = { family: candidate.family, index };
            }
        }
        return best;
    }

    function ssenseProductUrlIsArcTeryx(value) {
        if (!value) return false;
        try {
            const parsed = new URL(String(value), 'https://www.ssense.com');
            if (!(parsed.hostname === 'ssense.com' || parsed.hostname.endsWith('.ssense.com'))) return false;
            return /\/(?:[a-z]{2}-[a-z]{2}\/)?(?:men|women)\/product\/arcteryx\//i.test(parsed.pathname);
        } catch (_) {
            return false;
        }
    }

    function isArcTeryxProduct(product) {
        const dealer = String(product && product.dealer || '').toLowerCase();
        const url = String(product && product.url || '');
        const fromSsense = dealer === 'ssense' || /(^|\.)ssense\.com(?=\/|$)/i.test(url.replace(/^https?:\/\//i, ''));
        return fromSsense ? ssenseProductUrlIsArcTeryx(url) : true;
    }

    function standardProductName(raw, context) {
        const product = context || {};
        let value = normalizeWhitespace(raw);
        if (!value) return '';

        value = value.replace(BRAND_PREFIX, '');
        value = value.replace(/^veilance(?=[A-Z])/, 'Veilance ');
        value = normalizeKnownTokenCase(normalizeWhitespace(value));

        // SSENSE prefixes names with one or more color words. Only remove that
        // prefix when both the URL proves the Arc'teryx brand and a registered
        // model family is found; otherwise preserve the input unchanged.
        if ((String(product.dealer || '').toLowerCase() === 'ssense' || /ssense\.com/i.test(String(product.url || '')))
            && isArcTeryxProduct(product)) {
            const family = findFamilyMatch(value);
            if (family && family.index > 0) value = value.slice(family.index);
        }

        let gender = '';
        let genderMatch = null;
        for (const candidate of GENDER_PATTERNS) {
            const match = candidate.pattern.exec(value);
            if (match && (!genderMatch || match.index < genderMatch.index)) {
                genderMatch = { index: match.index, length: match[0].length, label: candidate.label };
            }
        }

        if (genderMatch) {
            gender = genderMatch.label;
            if (genderMatch.index === 0) {
                value = value.slice(genderMatch.length).replace(/^\s*[-–—]\s*/, '').trim();
            } else {
                value = value.slice(0, genderMatch.index).replace(/\s*[-–—]\s*$/, '').trim();
            }
        } else {
            gender = normalizeGender(product.gender);
        }

        value = normalizeKnownTokenCase(normalizeWhitespace(value));
        if (!value) return '';
        return gender ? `${value} ${gender}` : value;
    }

    function extractModelFamily(standardName) {
        const value = normalizeKnownTokenCase(normalizeWhitespace(standardName).replace(BRAND_PREFIX, ''));
        const firstToken = value.split(/\s+/)[0] || '';
        return FAMILY_BY_KEY.get(firstToken.toLowerCase()) || null;
    }

    return Object.freeze({
        MODEL_FAMILIES,
        extractModelFamily,
        isArcTeryxProduct,
        standardProductName,
    });
}));
