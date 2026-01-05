import sys
import logging
from .config import load_config
from .runner import Runner

def setup_logging(debug: bool):
    level = logging.DEBUG if debug else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%H:%M:%S"
    )

def main():
    try:
        config = load_config()
        setup_logging(config.debug)
        
        runner = Runner(config)
        runner.execute()
        
    except Exception as e:
        print(f"FATAL ERROR: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
