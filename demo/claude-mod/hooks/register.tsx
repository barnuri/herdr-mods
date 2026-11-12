import { atom, read, update } from 'claude-code'

const turns = atom({ plugin: 'summaries', key: 'turns' }, [] as string[])
const tools = atom({ plugin: 'summaries', key: 'tools' }, 0)

export const register = (on: any, options: any) => {
  on('session.start', async ($: any, e: any, next: any) => {
    await $.ui.open({ id: 'summary', title: options.title })
    return next(e)
  })
  on('tool.call', async ($: any, e: any, next: any) => {
    await update($, tools, (n: number) => n + 1)
    return next(e)
  })
  on('turn.complete', async ($: any, e: any, next: any) => {
    await update($, turns, (list: string[]) => [...list, e.answer])
    return next(e)
  })
  on('ui.render', { component: 'Pane', requestId: 'summary' }, async ($: any, e: any) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const done = await read($, turns)
    return (
      <Box flexDirection="column">
        <Text bold color="#D77757">{options.title}</Text>
        <Text dimColor>{`${done.length} turns, ${await read($, tools)} tool calls`}</Text>
        {done.slice(-6).map((answer: string) => <Text>{`✓ ${answer}`}</Text>)}
        <Button hotkey="c" onPress={() => void update($, turns, () => [])}>
          <Text underline>[c] clear</Text>
        </Button>
      </Box>
    )
  })
}
