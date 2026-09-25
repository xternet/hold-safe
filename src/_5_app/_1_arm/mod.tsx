import { useState } from "react";
import type { Coverage } from "../_shared/_0_service/mod";
import type { Login } from "../_shared/_1_identity/mod";
import { PolicyForm } from "./_1_form/mod";
import { PolicyReview } from "./_2_review/mod";
import type { Reviewed } from "./_shared/mod";
export function ArmPolicy({ session, coverage }: { session: Login; coverage: Coverage }) {
  const [review, setReview] = useState<Reviewed | null>(null);
  return review === null ? <PolicyForm session={session} coverage={coverage} onReview={setReview}/> :
    <PolicyReview session={session} coverage={coverage} review={review} onBack={() => setReview(null)}/>;
}
