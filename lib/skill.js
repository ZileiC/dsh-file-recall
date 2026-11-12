/**
 * Runtime skill registration: the skill body ships with the plugin and is
 * registered in memory, so installing one bundle delivers both the tools and
 * the procedure that tells the model how to use them.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const MODULE_DIR = dirname(fileURLToPath(import.meta.url))
const SKILL_PATH = join(MODULE_DIR, '..', 'skills', 'file-recall', 'SKILL.md')
const TIDY_SKILL_PATH = join(MODULE_DIR, '..', 'skills', 'file-tidy', 'SKILL.md')

export const SKILL_NAME = 'file-recall'
export const TIDY_SKILL_NAME = 'file-tidy'

export function loadSkillContent() {
  return readFileSync(SKILL_PATH, 'utf8').trim()
}

export function loadTidySkillContent() {
  return readFileSync(TIDY_SKILL_PATH, 'utf8').trim()
}

export function createSkillRegistration() {
  return {
    name: SKILL_NAME,
    description:
      '在本地资料库中按模糊描述定位文件与页/幻灯片，并给出可核验的证据片段。',
    whenToUse:
      '当用户只记得旧文档的零散细节、说不清文件或页码时使用；先查索引、再搜索、读页验证后回答。',
    source: 'runtime',
    invocation: { modelInvocable: true, userInvocable: true },
    content: loadSkillContent(),
  }
}

/**
 * The tidy skill is deliberately paired with a read-only tool: the procedure
 * tells the model to produce a proposal and stop, so a destructive step can
 * never be improvised from this skill.
 */
export function createTidySkillRegistration() {
  return {
    name: TIDY_SKILL_NAME,
    description:
      '为本地资料库生成只读整理方案：散落文件、相机/扫描仪命名、无日期命名、重复名、超载文件夹。只出方案，不动文件。',
    whenToUse:
      '当用户明确要求整理、重命名或归档本地文件，或抱怨文件太乱找不到时使用；只会生成方案并要求用户确认。',
    source: 'runtime',
    invocation: { modelInvocable: true, userInvocable: true },
    content: loadTidySkillContent(),
  }
}
