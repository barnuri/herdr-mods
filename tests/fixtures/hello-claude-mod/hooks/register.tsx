import { atom, read, update } from 'claude-code'

const turns = atom({ plugin: 'hello', key: 'turns' }, [] as string[])
const clicks = atom({ plugin: 'hello', key: 'clicks' }, 0)

export const register = (on: any, options: any) => {
  on('session.start', async ($: any, e: any, next: any) => {
    await $.command.register({ name: 'hello', description: 'Open the hello pane' })
    return next(e)
  })
  on('turn.complete', async ($: any, e: any, next: any) => {
    await update($, turns, (list: string[]) => [...list, e.answer])
    await $.ui.open({ id: 'hello', title: 'Hello' })
    return next(e)
  })
  on('command.run', { command: 'hello' }, async ($: any, e: any) => {
    await $.ui.open({ id: 'hello', title: 'Hello' })
    return { text: `${options.greeting} ${e.args}` }
  })
  on('ui.render', { component: 'Pane', requestId: 'hello' }, async ($: any, e: any) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const count = await read($, clicks)
    return (
      <Box flexDirection="column">
        <Text bold>{`turns: ${(await read($, turns)).join(', ')}`}</Text>
        <Button hotkey="c" onPress={() => void update($, clicks, (n: number) => n + 1)}>
          <Text underline>{`clicked ${count}`}</Text>
        </Button>
      </Box>
    )
  })
}
