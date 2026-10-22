import {
  Braces,
  FilePenLine,
  FileSearch,
  FileText,
  FolderOpen,
  GitBranch,
  Globe,
  ListChecks,
  PackageOpen,
  Search,
  Sparkles,
  Terminal,
  Wrench,
  type LucideIcon,
} from 'lucide-react'

export function toolIcon(name: string): LucideIcon {
  if (name === 'pwsh' || name === 'bash' || name === 'terminal') return Terminal
  if (name === 'read' || name === 'read_image') return FileText
  if (name === 'write') return FilePenLine
  if (name === 'edit' || name === 'str_replace_editor') return FilePenLine
  if (name === 'grep' || name === 'glob') return FileSearch
  if (name === 'web_search' || name === 'web_fetch') return Globe
  if (name === 'present') return PackageOpen
  if (name === 'todo_write' || name === 'create_goal' || name === 'update_goal') return ListChecks
  if (name === 'subagent' || name === 'subagent_fork') return GitBranch
  if (name === 'run_code') return Braces
  if (name === 'working_directory') return FolderOpen
  if (name === 'skill') return Sparkles
  if (name === 'ask_user_question') return Search
  return Wrench
}
