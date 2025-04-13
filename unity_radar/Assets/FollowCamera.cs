using UnityEngine;

public class FollowCamera : MonoBehaviour
{
    public Transform player;

    void LateUpdate()
    {
        if (player != null)
        {
            transform.position = player.position - new Vector3(0, 0, 10);
        }
    }
}
