"""`python -m agent_platform` — serve the API, or scaffold new agents/tools.

Commands:
    python -m agent_platform                       # serve (default)
    python -m agent_platform serve
    python -m agent_platform new-agent my_agent
    python -m agent_platform new-tool my_tool --category my_category

The serve path exists (rather than only documenting a raw uvicorn command)
so the selector event-loop policy is set before uvicorn creates its loop on
Windows — psycopg's async mode can't run on the default ProactorEventLoop.
"""

import argparse
import asyncio
import sys

from agent_platform.scaffold import create_agent, create_tool


def _serve() -> None:
    import uvicorn

    from agent_platform.config import get_settings

    loop = "auto"
    if sys.platform == "win32":
        # uvicorn's "auto" loop factory picks ProactorEventLoop on Windows,
        # overriding the policy — "none" defers to the policy set here.
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
        loop = "none"
    settings = get_settings()
    uvicorn.run(
        "agent_platform.api.app:app",
        host=settings.server_host,
        port=settings.server_port,
        log_level=settings.log_level.lower(),
        loop=loop,
    )


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m agent_platform")
    sub = parser.add_subparsers(dest="command")

    sub.add_parser("serve", help="Run the API server (default)")

    new_agent = sub.add_parser("new-agent", help="Scaffold a registry-ready agent")
    new_agent.add_argument("name", help="snake_case agent name, e.g. billing_agent")

    new_tool = sub.add_parser("new-tool", help="Scaffold a registry-ready tool")
    new_tool.add_argument("name", help="snake_case tool name, e.g. create_invoice")
    new_tool.add_argument("--category", default="general", help="Tool category agents request")

    args = parser.parse_args(argv)

    if args.command == "new-agent":
        for path in create_agent(args.name):
            print(f"created {path}")
        print(f"\nRestart the server and '{args.name}' is discovered — the router can pick it,")
        print("the playground renders its graph, and the Tests view can target it.")
    elif args.command == "new-tool":
        for path in create_tool(args.name, category=args.category):
            print(f"created {path}")
        print(f"\nAdd '{args.category}' to an agent's tool_access.categories to hand it this tool.")
    else:
        _serve()


if __name__ == "__main__":
    main()
