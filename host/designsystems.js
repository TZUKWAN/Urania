/**
 * DesignCraft design systems (OpenDesign fusion).
 * Curated token presets + apply logic (var(--color-*) references resolve live at render time).
 */
import { defaultDesignSystem } from './decklayouts.js';

export const DESIGN_SYSTEMS = {
	'craft-default': {
		name: 'Craft 默认', description: 'DesignCraft 出厂设计系统：稳重、通用、可读性优先。',
		tokens: defaultDesignSystem()
	},
	'midnight-blue': {
		name: '午夜蓝', description: '深色科技风，适合产品发布与技术分享。',
		tokens: {
			colors: { primary: '#5EA8FF', accent: '#8CCFBC', ink: '#ECF0F5', muted: '#8C9AAE', bg: '#101826', surface: '#1B2536', success: '#4ADE80', warning: '#FBBF24', danger: '#F87171' },
			fonts: { heading: 'Segoe UI, Microsoft YaHei, sans-serif', body: 'Segoe UI, Microsoft YaHei, sans-serif' },
			radius: { sm: 8, md: 14, lg: 24 }, spacing: { sm: 8, md: 16, lg: 32 }
		}
	},
	'aurora-green': {
		name: '极光绿', description: '自然生长感，适合环保、健康、生活方式主题。',
		tokens: {
			colors: { primary: '#2FBF8F', accent: '#9EE493', ink: '#EAF5F0', muted: '#93B8A9', bg: '#0E1F1A', surface: '#143028', success: '#86EFAC', warning: '#FCD34D', danger: '#F87171' },
			fonts: { heading: 'Georgia, STZhongsong, serif', body: 'Segoe UI, Microsoft YaHei, sans-serif' },
			radius: { sm: 10, md: 18, lg: 28 }, spacing: { sm: 10, md: 20, lg: 40 }
		}
	},
	'ivory-warm': {
		name: '象牙暖调', description: '温暖编辑风，适合杂志、文化、品牌故事。',
		tokens: {
			colors: { primary: '#B4633A', accent: '#D9A45B', ink: '#2B2622', muted: '#8A8178', bg: '#FAF7F2', surface: '#FFFFFF', success: '#5F8D4E', warning: '#C8862B', danger: '#A3442C' },
			fonts: { heading: 'Georgia, STZhongsong, serif', body: 'Segoe UI, Microsoft YaHei, sans-serif' },
			radius: { sm: 4, md: 8, lg: 16 }, spacing: { sm: 8, md: 16, lg: 32 }
		}
	},
	'corporate-blue': {
		name: '商务蓝', description: '清晰可信，适合年报、方案汇报、企业官网。',
		tokens: {
			colors: { primary: '#2563EB', accent: '#0EA5E9', ink: '#1A2733', muted: '#64748B', bg: '#FFFFFF', surface: '#F1F5F9', success: '#16A34A', warning: '#D97706', danger: '#DC2626' },
			fonts: { heading: 'Segoe UI, Microsoft YaHei, sans-serif', body: 'Segoe UI, Microsoft YaHei, sans-serif' },
			radius: { sm: 6, md: 10, lg: 16 }, spacing: { sm: 8, md: 16, lg: 32 }
		}
	},
	'sunset-bold': {
		name: '落日橙红', description: '高能量渐变风，适合营销活动与发布日。',
		tokens: {
			colors: { primary: '#E86A4A', accent: '#F2B45C', ink: '#FBEFE8', muted: '#C39A8E', bg: '#1F1418', surface: '#2D1C22', success: '#86EFAC', warning: '#FCD34D', danger: '#F87171' },
			fonts: { heading: 'Segoe UI, Microsoft YaHei, sans-serif', body: 'Segoe UI, Microsoft YaHei, sans-serif' },
			radius: { sm: 12, md: 22, lg: 32 }, spacing: { sm: 10, md: 20, lg: 40 }
		}
	},
	'forest-calm': {
		name: '森林静默', description: '浅色自然系，适合教育、研究、可持续主题。',
		tokens: {
			colors: { primary: '#287E59', accent: '#7FB069', ink: '#1D2B22', muted: '#71857A', bg: '#F4F8F4', surface: '#FFFFFF', success: '#287E59', warning: '#9E7129', danger: '#B44846' },
			fonts: { heading: 'Segoe UI, Microsoft YaHei, sans-serif', body: 'Segoe UI, Microsoft YaHei, sans-serif' },
			radius: { sm: 8, md: 14, lg: 22 }, spacing: { sm: 8, md: 16, lg: 32 }
		}
	},
	'graphite-mono': {
		name: '石墨单色', description: '极简黑白灰，适合摄影集、作品集、极客风。',
		tokens: {
			colors: { primary: '#9CA3AF', accent: '#E5E7EB', ink: '#F2F2F2', muted: '#9BA0A6', bg: '#17181A', surface: '#242629', success: '#A3E635', warning: '#FBBF24', danger: '#F87171' },
			fonts: { heading: 'Consolas, Cascadia Code, monospace', body: 'Segoe UI, Microsoft YaHei, sans-serif' },
			radius: { sm: 2, md: 4, lg: 8 }, spacing: { sm: 8, md: 16, lg: 32 }
		}
	},
	'crimson-academy': {
		name: '绯红学术', description: '学术评审风，适合开题、答辩、期刊汇报。',
		tokens: {
			colors: { primary: '#B44846', accent: '#E1A140', ink: '#25161A', muted: '#8C7378', bg: '#FFFFFF', surface: '#FBF3F3', success: '#3F7A54', warning: '#B4832B', danger: '#B44846' },
			fonts: { heading: 'Times New Roman, SimSun, serif', body: 'Segoe UI, Microsoft YaHei, sans-serif' },
			radius: { sm: 4, md: 8, lg: 14 }, spacing: { sm: 8, md: 16, lg: 32 }
		}
	}
};

export function listDesignSystems() {
	return Object.entries(DESIGN_SYSTEMS).map(([id, ds]) => ({ id, name: ds.name, description: ds.description }));
}

export function getDesignSystem(id) {
	return DESIGN_SYSTEMS[id] ? { id, name: DESIGN_SYSTEMS[id].name, description: DESIGN_SYSTEMS[id].description, tokens: DESIGN_SYSTEMS[id].tokens } : null;
}
