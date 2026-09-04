from dataclasses import dataclass


@dataclass
class Review:
    id: str
    state: str


def submit(review: Review) -> bool:
    if review.state == "PENDING":
        return False
    return True
