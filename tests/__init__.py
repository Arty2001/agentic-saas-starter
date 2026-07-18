import logging
import os
import random
import time

from agent_platform.config import get_settings

test_id = f'''{round(random.random() * 1_000_000)}'''
# Windows-safe filename: no colons or spaces.
test_time = time.strftime('%Y-%m-%d_%H-%M-%S')

_project_root_path = os.path.join(
    os.path.dirname(__file__),
    '..',
)

def init_logs(log_level: int = logging.INFO) -> logging.Logger:

    formatter = logging.Formatter(
        style='{',
        fmt='[{levelname}|{asctime}|{msecs:.0f}|{name}] {message}',
        datefmt='%y-%m-%d %H:%M:%S',
    )
    log_dir = os.path.join( _project_root_path, '.logs')
    try:
        os.mkdir(log_dir)
    except FileExistsError:
        pass
    current_dir = os.path.basename(os.path.dirname(__file__))
    log_file_name = f'''test-{test_id}-{test_time}.log'''
    log_file_path = os.path.join(log_dir, log_file_name)
    file_handler = logging.FileHandler(log_file_path)
    file_handler.setLevel(log_level)
    file_handler.setFormatter(formatter)

    stream_handler = logging.StreamHandler()
    stream_handler.setFormatter(formatter)
    stream_handler.setLevel(log_level)

    logger = logging.getLogger()
    logger.handlers.clear()

    logger.setLevel(log_level)
    logger.addHandler(stream_handler)
    logger.addHandler(file_handler)
    logger.info(f'\n{log_dir = }\n{current_dir = }\n{_project_root_path = }\n{log_file_name = }\n')

    return logger


_logger = init_logs()


try:
    from dotenv import load_dotenv
    load_dotenv(
        dotenv_path=os.path.join(_project_root_path, '.env'),
        verbose=True,
    )
except ImportError:
    ...

settings = get_settings()

