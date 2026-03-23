// draft_class_utils.js
// Utilities for robust Madden draft class file lookup and loading
import fs from 'fs';
import path from 'path';
import { getMaddenDraftClassId } from './madden_draft_class.js';

const DRAFT_DIR = path.join(process.cwd(), 'data', 'draft_classes', 'madden');

function safeReadJSON(file, fallback = null) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

export function findClassFile(classId) {
    if (!fs.existsSync(DRAFT_DIR)) return null;
    const patterns = [
        classId.toLowerCase(),
        classId.replace('_', '').toLowerCase(),
        classId.replace('_', '').toUpperCase(),
    ];
    const files = fs.readdirSync(DRAFT_DIR).filter(f => {
        const low = f.toLowerCase();
        return patterns.some(p => low.includes(p)) && low.endsWith('.json');
    });
    if (files.length) return path.join(DRAFT_DIR, files[0]);
    const allJson = fs.readdirSync(DRAFT_DIR).filter(f => f.toLowerCase().endsWith('.json'));
    return allJson.length ? path.join(DRAFT_DIR, allJson[0]) : null;
}

export function loadDraftClass(classId, context = {}) {
    const file = findClassFile(classId);
    const logInfo = {
        event: 'draft_class_lookup',
        command: context.command || 'draft_class_utils',
        guildId: context.guildId || null,
        userId: context.userId || null,
        classId,
        resolvedFile: file,
        timestamp: new Date().toISOString(),
    };
    if (!file) {
        logInfo.error = 'Draft class file not found';
        console.error('[LEAGUEBUDDY][DRAFT_CLASS_LOOKUP][ERROR]', JSON.stringify(logInfo));
        return null;
    }
    try {
        const data = safeReadJSON(file, null);
        logInfo.success = true;
        console.log('[LEAGUEBUDDY][DRAFT_CLASS_LOOKUP][SUCCESS]', JSON.stringify(logInfo));
        return data;
    } catch (e) {
        logInfo.error = e && e.message;
        console.error('[LEAGUEBUDDY][DRAFT_CLASS_LOOKUP][ERROR]', JSON.stringify(logInfo));
        return null;
    }
}


export function getAllDraftClasses(guildId = null) {
    // Optionally use guildId for per-guild directories, but default is global
    const dir = DRAFT_DIR;
    if (!fs.existsSync(dir)) return [];
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    return files.map(file => {
        try {
            const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
            return { file, data };
        } catch {
            return { file, data: null };
        }
    });
}

export default {
    findClassFile,
    loadDraftClass,
    getAllDraftClasses,
};
