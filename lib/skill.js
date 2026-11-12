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

export const SKILL_NAME = 'file-recall'

export function loadSkillContent() {
  return readFileSync(SKILL_PATH, 'utf8').trim()
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
