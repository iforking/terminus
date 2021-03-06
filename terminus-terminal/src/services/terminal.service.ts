import { Observable, AsyncSubject } from 'rxjs'
import { Injectable, Inject } from '@angular/core'
import { AppService, Logger, LogService, ConfigService } from 'terminus-core'
import { IShell, ShellProvider, SessionOptions } from '../api'
import { TerminalTabComponent } from '../components/terminalTab.component'
import { UACService } from './uac.service'

@Injectable({ providedIn: 'root' })
export class TerminalService {
    private shells = new AsyncSubject<IShell[]>()
    private logger: Logger

    get shells$ (): Observable<IShell[]> { return this.shells }

    constructor (
        private app: AppService,
        private config: ConfigService,
        private uac: UACService,
        @Inject(ShellProvider) private shellProviders: ShellProvider[],
        log: LogService,
    ) {
        this.logger = log.create('terminal')
        this.reloadShells()

        config.changed$.subscribe(() => {
            this.reloadShells()
        })
    }

    async getShells (): Promise<IShell[]> {
        let shellLists = await Promise.all(this.config.enabledServices(this.shellProviders).map(x => x.provide()))
        return shellLists.reduce((a, b) => a.concat(b), [])
    }

    async reloadShells () {
        this.shells = new AsyncSubject<IShell[]>()
        let shells = await this.getShells()
        this.logger.debug('Shells list:', shells)
        this.shells.next(shells)
        this.shells.complete()
    }

    async openTab (shell?: IShell, cwd?: string, pause?: boolean): Promise<TerminalTabComponent> {
        if (!cwd) {
            if (this.app.activeTab instanceof TerminalTabComponent && this.app.activeTab.session) {
                cwd = await this.app.activeTab.session.getWorkingDirectory()
            }
            cwd = cwd || this.config.store.terminal.workingDirectory
            cwd = cwd || null
        }
        if (!shell) {
            let shells = await this.shells$.toPromise()
            shell = shells.find(x => x.id === this.config.store.terminal.shell) || shells[0]
        }

        this.logger.log(`Starting shell ${shell.name}`, shell)
        let sessionOptions = {
            ...this.optionsFromShell(shell),
            pauseAfterExit: pause,
            cwd,
        }

        return this.openTabWithOptions(sessionOptions)
    }

    optionsFromShell (shell: IShell): SessionOptions {
        return {
            command: shell.command,
            args: shell.args || [],
            env: shell.env,
        }
    }

    openTabWithOptions (sessionOptions: SessionOptions): TerminalTabComponent {
        if (sessionOptions.runAsAdministrator && this.uac.isAvailable) {
            sessionOptions = this.uac.patchSessionOptionsForUAC(sessionOptions)
        }
        this.logger.log('Using session options:', sessionOptions)

        return this.app.openNewTab(
            TerminalTabComponent,
            { sessionOptions }
        ) as TerminalTabComponent
    }
}
